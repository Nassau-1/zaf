/**
 * server.js — ZAF Control Plane (Paperclip-grade)
 *
 *   - HTTP + multi-stream SSE
 *   - PTY-based in-app multi-console (TKT-ZAF-0013)
 *   - Manual steering / kill controls (TKT-ZAF-0014)
 *   - Budget gate + heartbeat sweeper (TKT-ZAF-0015)
 *   - Append-only audit log (audit-log.jsonl)
 *   - Dynamic CLI capability discovery (`--help` parser)
 *   - Live workspace markdown watcher (chokidar)
 *
 * Usage: node server.js [PORT=4242] [REPOS_ROOT=../../]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execSync, spawn } = require('child_process');
const chokidar = require('chokidar');
const nodePty = require('@homebridge/node-pty-prebuilt-multiarch');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4242', 10);
const REPOS_ROOT = path.resolve(process.env.REPOS_ROOT || path.resolve(__dirname, '../../'));

const STATIC_DIR = __dirname;
const PARSE_SCRIPT = path.join(__dirname, 'parse.js');
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const AUDIT_FILE = path.join(__dirname, 'audit-log.jsonl');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ─── State ───────────────────────────────────────────────────────────────────

let sseClients = [];                           // [{ res }]
const processes = new Map();                   // processId -> { proc, meta, buffer, prefireTimer? }
let nextProcessId = 1;
const fleetProcessIds = new Set();             // processIds spawned via fleet dispatch

// ─── Audit Log (append-only) ─────────────────────────────────────────────────

function auditAppend(event) {
  try {
    const entry = { ts: new Date().toISOString(), ...event };
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
    broadcast({ event: 'audit', entry });
    return entry;
  } catch (e) {
    console.error('[AUDIT] append failed:', e.message);
    return null;
  }
}

function auditRead(limit = 500) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const data = fs.readFileSync(AUDIT_FILE, 'utf8');
    const lines = data.trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ─── SSE broadcast ───────────────────────────────────────────────────────────

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const dead = [];
  for (const c of sseClients) {
    try { c.res.write(data); } catch { dead.push(c); }
  }
  if (dead.length) sseClients = sseClients.filter(c => !dead.includes(c));
}

function pushReload() { broadcast({ event: 'reload' }); }

// ─── File watcher ────────────────────────────────────────────────────────────

let debounceTimer = null;

function startWatcher() {
  const watchGlob = path.join(REPOS_ROOT, '*/WIP/**/*.md').replace(/\\/g, '/');
  console.log(`[WATCH] Watching: ${watchGlob}`);
  const watcher = chokidar.watch(watchGlob, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const trigger = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { runParse(); pushReload(); }, 500);
  };
  watcher.on('add', trigger).on('change', trigger).on('unlink', trigger);
  watcher.on('error', err => console.error('[WATCH]', err));
}

function runParse() {
  try {
    execSync(`node "${PARSE_SCRIPT}" --repos-root "${REPOS_ROOT}"`, {
      cwd: __dirname, timeout: 30000, stdio: 'inherit',
    });
  } catch (err) {
    console.error('[PARSE]', err.message);
  }
}

// ─── Config helpers ──────────────────────────────────────────────────────────

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return null; }
}

function writeConfig(conf) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), 'utf8');
  const distPath = path.join(__dirname, 'dist', 'config.json');
  if (fs.existsSync(path.dirname(distPath))) {
    try { fs.writeFileSync(distPath, JSON.stringify(conf, null, 2), 'utf8'); } catch {}
  }
}

// ─── Config migration (TKT-ZAF-0029) ────────────────────────────────────────

function migrateConfig() {
  const conf = readConfig();
  if (!conf || !conf.agents) return;
  let changed = false;
  const modelMap = { frontier: 'claude-sonnet-4-6', normal: 'claude-haiku-4-5-20251001', reasoning: 'claude-sonnet-4-6' };
  for (const agent of Object.values(conf.agents)) {
    if (agent.model && !agent.modelId) {
      agent.modelId = modelMap[agent.model] || agent.customModel || 'claude-sonnet-4-6';
      changed = true;
    }
    if (agent.personality === undefined) { agent.personality = ''; changed = true; }
    if (agent.team === undefined)        { agent.team = null;       changed = true; }
    if (agent.source === undefined)      { agent.source = null;     changed = true; }
  }
  if (changed) { writeConfig(conf); console.log('[MIGRATE] agent schema migration applied'); }
}

// ─── Template helper (TKT-ZAF-0028) ─────────────────────────────────────────

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ─── PTY harness configuration (TKT-ZAF-0013) ───────────────────────────────

// Real interactive CLIs that need PTY + 10-second pre-fire seed injection
const PTY_REAL_HARNESSES = new Set(['claude-code', 'claude', 'codex', 'gemini-cli', 'gemini']);

// Rate-limit detection patterns per harness (TKT-ZAF-0015)
const RATE_LIMIT_PATTERNS = {
  'claude-code': /rate.?limit|quota.?exceeded|too.?many.?requests|429/i,
  'claude':      /rate.?limit|quota.?exceeded|too.?many.?requests|429/i,
  'codex':       /429|rate.?limit|quota/i,
  'gemini-cli':  /RESOURCE_EXHAUSTED|429|quota/i,
  'gemini':      /RESOURCE_EXHAUSTED|429|quota/i,
};

// ─── Seed prompt composer ────────────────────────────────────────────────────

function composeSeedPrompt(opts, ticketBody) {
  const { ticketId, role, modelId, model, reasoning, heartbeat, promptAddendum, ticketTitle, repoName, personality } = opts;
  const effectiveModel = modelId || model || '(default for this CLI)';
  const personalitySection = personality ? `\n## Personality & Scope\n${personality}\n` : '';
  return `# ZO.AF Agent Run — ${ticketId}

You are operating under the ZO Agentic Framework (ZAF) control plane. Read this entire block before doing anything.

## Identity
- **Role**: \`${role}\`
- **Ticket**: \`${ticketId}\` — ${ticketTitle || ''}
- **Repository**: \`${repoName || ''}\`
- **Model target**: ${effectiveModel}
- **Reasoning level**: ${reasoning || 'medium'}
- **Heartbeat interval**: ${heartbeat || '40'} seconds
${personalitySection}
## Ticket body

\`\`\`markdown
${ticketBody || '(ticket body could not be loaded)'}
\`\`\`

## Operational constraints (hard requirements)
1. **Stay within ticket scope.** Read/write only files under the target repo, and only files relevant to this ticket.
2. **Append, never edit, the Handoff Log.** Before you exit, append one new entry at the bottom of the ticket's \`## Handoff Log\` section.
3. **Update ticket status if appropriate.** Move \`status:\` to \`IN_PROGRESS\` when you start, \`DONE\` when acceptance criteria are met, \`BLOCKED\` if blocked.
4. **Stop on ambiguity.** If a credential, policy, or requirement is unclear, do NOT guess. Set status to \`BLOCKED\` and stop.
5. **No secrets in output.**

${promptAddendum ? `## Per-ticket addendum (from operator)\n\n${promptAddendum}\n` : ''}## Start of work

Begin by stating (in one sentence) your understanding of this ticket and your first concrete step. Then proceed.
`;
}

// ─── PTY-based subprocess spawn (TKT-ZAF-0013/0014/0015) ────────────────────

const zoScript = path.join(__dirname, '..', 'cli', 'zo.js');

function spawnAgent(opts) {
  const { ticketId, role, harness, modelId, model, reasoning, heartbeat, promptAddendum, repoId, isFleet } = opts;
  const effectiveModelId = modelId || model || '';

  const processId = `P-${String(nextProcessId++).padStart(4, '0')}`;
  const startTime = Date.now();
  const startISO = new Date(startTime).toISOString();
  const repoSlug = repoId || 'zo-agentic-framework';
  const repoRoot = path.resolve(REPOS_ROOT, repoSlug);
  const isRealCli = PTY_REAL_HARNESSES.has(harness);

  // Resolve personality from config if not supplied directly
  let personality = opts.personality || '';
  if (!personality) {
    try {
      const conf = readConfig();
      personality = conf?.agents?.[role]?.personality || '';
    } catch {}
  }

  // Compose seed for real CLIs
  let seedText = '';
  if (isRealCli) {
    const ticketPath = path.join(repoRoot, 'WIP', 'tickets', 'ACTIVE', `${ticketId}.md`);
    let ticketBody = '';
    try { ticketBody = fs.readFileSync(ticketPath, 'utf8'); } catch {}
    const titleMatch = ticketBody.match(/^title:\s*(.+)$/m);
    const ticketTitle = titleMatch ? titleMatch[1].trim() : ticketId;
    seedText = composeSeedPrompt({ ticketId, role, modelId: effectiveModelId, reasoning, heartbeat, promptAddendum, ticketTitle, repoName: repoSlug, personality }, ticketBody);
  }

  // Determine PTY command
  // On Windows, node-pty needs either a full path or cmd.exe to resolve executables.
  let ptyCmd, ptyArgs, ptyCwd;
  if (harness === 'mock' || harness === 'zo') {
    // Use cmd.exe to wrap node so PATH resolution works reliably on Windows
    ptyCmd = 'cmd.exe';
    const nodeArgs = [zoScript, 'run', role, '--ticket', ticketId, '--harness', harness];
    if (effectiveModelId) nodeArgs.push('--model', effectiveModelId);
    if (reasoning)        nodeArgs.push('--reasoning', reasoning);
    if (heartbeat)        nodeArgs.push('--heartbeat', heartbeat);
    ptyArgs = ['/c', process.execPath, ...nodeArgs];
    ptyCwd = path.resolve(__dirname, '..');
  } else {
    // Real CLI — invoke via cmd.exe to resolve .cmd shims on Windows
    const cliMap = {
      'claude-code': ['npx', '-y', '@anthropic-ai/claude-code'],
      'claude':      ['npx', '-y', '@anthropic-ai/claude-code'],
      'codex':       effectiveModelId
                       ? ['npx', '-y', '@openai/codex', '--model', effectiveModelId]
                       : ['npx', '-y', '@openai/codex'],
      'gemini-cli':  ['npx', '-y', '@google/gemini-cli'],
      'gemini':      ['npx', '-y', '@google/gemini-cli'],
    };
    const cliTokens = cliMap[harness] || ['npx', '-y', '@anthropic-ai/claude-code'];
    ptyCmd = 'cmd.exe';
    ptyArgs = ['/c', ...cliTokens];
    ptyCwd = repoRoot;
  }

  const ptyEnv = {
    ...process.env,
    PAGER: 'cat',
    TERM: 'xterm-256color',
    ZAF_TICKET_ID: ticketId,
    ZAF_AGENT_ROLE: role,
    ZAF_HARNESS_ID: harness,
    ZAF_MODEL: model || '',
    ZAF_REASONING: reasoning || '',
    ZAF_HEARTBEAT: heartbeat || '',
    ZAF_PROMPT_ADDENDUM: promptAddendum || '',
  };

  const ptyProc = nodePty.spawn(ptyCmd, ptyArgs, {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    cwd: ptyCwd,
    env: ptyEnv,
  });

  const meta = {
    processId, pid: ptyProc.pid,
    ticketId, role, harness, modelId: effectiveModelId, reasoning, heartbeat,
    startedAt: startISO, startTime,
    status: isRealCli ? 'pre-fire' : 'running',
    exitCode: null, durationSec: null,
    cmd: `${ptyCmd} ${ptyArgs.join(' ')}`,
    isPty: true,
    repoId: repoSlug,
    retryCount: opts.retryCount || 0,
    isFleet: isFleet || false,
  };

  const buffer = []; // PTY byte chunks for replay: { data: base64, ts }
  const entry = { proc: ptyProc, meta, buffer };
  processes.set(processId, entry);

  auditAppend({ kind: 'process.spawn', processId, ticketId, role, harness, modelId: effectiveModelId, reasoning, heartbeat, cmd: meta.cmd });
  broadcast({ event: 'process.start', meta });

  // ANSI strip for text classification
  const ansiRe = /\x1b\[[0-9;]*[mGKHABCDEFJST]/g;
  let lineAccum = '';
  const ratePat = RATE_LIMIT_PATTERNS[harness];

  ptyProc.onData((rawChunk) => {
    // Relay raw bytes to all SSE clients as base64
    const encoded = Buffer.from(rawChunk).toString('base64');
    const chunk = { processId, data: encoded, ts: Date.now() };
    buffer.push(chunk);
    if (buffer.length > 3000) buffer.splice(0, buffer.length - 3000);
    broadcast({ event: 'process.pty', processId, data: encoded, ts: chunk.ts });

    // Text classification for audit (strip ANSI first)
    const text = rawChunk.replace(ansiRe, '');
    lineAccum += text;
    const textLines = lineAccum.split(/\r?\n/);
    lineAccum = textLines.pop();
    for (const line of textLines) {
      if (!line.trim()) continue;
      // Classify for audit
      let auditKind = null;
      if (/\[TOOL CALL\]|🛠️|Executing tool/i.test(line)) auditKind = 'agent.tool_call';
      else if (/\[API REQUEST\]|🌐|HTTP request/i.test(line)) auditKind = 'agent.api_request';
      else if (/\[DECISION\]|🧠|Decision|planning/i.test(line)) auditKind = 'agent.decision';
      if (auditKind) auditAppend({ kind: auditKind, processId, ticketId, role, line: line.slice(0, 200) });

      // Rate-limit detection (TKT-ZAF-0015)
      if (ratePat && ratePat.test(line) && meta.status === 'running') {
        meta.status = 'paused_rate_limit';
        meta.pausedAt = Date.now();
        auditAppend({ kind: 'process.limit_hit', processId, ticketId, harness, line: line.slice(0, 200) });
        broadcast({ event: 'process.limit_hit', processId, meta });
      }
    }
  });

  ptyProc.onExit(({ exitCode }) => {
    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    if (entry.prefireTimer) { clearTimeout(entry.prefireTimer); entry.prefireTimer = null; }

    if (meta.status !== 'paused_rate_limit') {
      meta.status = exitCode === 0 ? 'completed' : (exitCode === null ? 'killed' : 'failed');
    }
    meta.exitCode = exitCode;
    meta.durationSec = durationSec;
    meta.endedAt = new Date(endTime).toISOString();

    broadcast({ event: 'process.end', meta });
    auditAppend({ kind: 'process.end', processId, ticketId, role, exitCode, durationSec });

    // Update agent usage telemetry (real data only)
    try {
      const conf = readConfig();
      if (conf) {
        conf.agentUsage = conf.agentUsage || {};
        conf.agentUsage[role] = conf.agentUsage[role] || { runs: 0, secondsTotal: 0 };
        conf.agentUsage[role].runs += 1;
        conf.agentUsage[role].secondsTotal = parseFloat((conf.agentUsage[role].secondsTotal + durationSec).toFixed(3));
        conf.agentUsage[role].lastRun = new Date().toISOString();
        conf.agentUsage[role].harness = harness;
        conf.harnessUsage = conf.harnessUsage || {};
        conf.harnessUsage[harness] = conf.harnessUsage[harness] || { runs: 0, successes: 0 };
        conf.harnessUsage[harness].runs += 1;
        if (exitCode === 0) conf.harnessUsage[harness].successes += 1;
        writeConfig(conf);
      }
    } catch {}
    pushReload();
  });

  // T+2s model/reasoning injection for claude-code (TKT-ZAF-0029)
  if (isRealCli && (harness === 'claude-code' || harness === 'claude') && effectiveModelId) {
    const budgetMap = { high: 10000, medium: 3000, low: 0 };
    const budget = budgetMap[reasoning] ?? 3000;
    setTimeout(() => {
      if (meta.status !== 'pre-fire') return;
      ptyProc.write(`/model ${effectiveModelId}\r`);
      auditAppend({ kind: 'process.model_injected', processId, ticketId, modelId: effectiveModelId });
      setTimeout(() => {
        if (meta.status !== 'pre-fire') return;
        ptyProc.write(`/thinking budget ${budget}\r`);
        auditAppend({ kind: 'process.reasoning_injected', processId, ticketId, budget });
      }, 500);
    }, 2000);
  }

  // 10-second pre-fire countdown for real CLIs (TKT-ZAF-0013)
  if (isRealCli) {
    const prefireDeadline = new Date(startTime + 10000).toISOString();
    broadcast({ event: 'process.prefire', processId, prefireDeadline });
    entry.prefireTimer = setTimeout(() => {
      if (meta.status !== 'pre-fire') return;
      meta.status = 'running';
      ptyProc.write(seedText + '\r');
      auditAppend({ kind: 'process.seeded', processId, ticketId, seedLength: seedText.length });
      broadcast({ event: 'process.seeded', processId });
    }, 10000);
  }

  return meta;
}

// ─── Inline PTY spawn for CLI Hub (TKT-ZAF-0019) ─────────────────────────────

function spawnInlinePty({ cmd, args, cwd, label, harnessId, kind }) {
  const processId = `P-${String(nextProcessId++).padStart(4, '0')}`;
  const startTime = Date.now();

  // On Windows wrap in cmd.exe so PATH/.cmd shims resolve correctly
  let ptyCmd, ptyArgs;
  if (process.platform === 'win32') {
    ptyCmd = 'cmd.exe';
    ptyArgs = ['/c', cmd, ...(args || [])];
  } else {
    ptyCmd = cmd;
    ptyArgs = args || [];
  }

  const ptyProc = nodePty.spawn(ptyCmd, ptyArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: cwd || __dirname,
    env: { ...process.env, PAGER: 'cat', TERM: 'xterm-256color' },
  });

  const meta = {
    processId, pid: ptyProc.pid,
    kind: 'cli-hub',
    cliHubKind: kind || 'inline',
    label: label || cmd,
    harnessId: harnessId || '',
    startedAt: new Date(startTime).toISOString(), startTime,
    status: 'running',
    exitCode: null, durationSec: null,
    // dummy fields to satisfy client schema
    ticketId: 'CLI-HUB', role: 'operator', harness: harnessId || 'cli-hub',
    model: '', modelId: '', reasoning: '', heartbeat: '',
    isPty: true, isFleet: false, repoId: '',
  };

  const buffer = [];
  const entry = { proc: ptyProc, meta, buffer };
  processes.set(processId, entry);

  broadcast({ event: 'process.start', meta });

  ptyProc.onData((rawChunk) => {
    const encoded = Buffer.from(rawChunk).toString('base64');
    const chunk = { processId, data: encoded, ts: Date.now() };
    buffer.push(chunk);
    if (buffer.length > 3000) buffer.splice(0, buffer.length - 3000);
    broadcast({ event: 'process.pty', processId, data: encoded, ts: chunk.ts });
  });

  ptyProc.onExit(({ exitCode }) => {
    const endTime = Date.now();
    meta.status = exitCode === 0 ? 'completed' : (exitCode === null ? 'killed' : 'failed');
    meta.exitCode = exitCode;
    meta.durationSec = (endTime - startTime) / 1000;
    meta.endedAt = new Date(endTime).toISOString();
    broadcast({ event: 'process.end', meta });
    auditAppend({ kind: 'cli-hub.pty-end', processId, harnessId: harnessId || '', label: label || cmd, exitCode });
  });

  auditAppend({ kind: 'cli-hub.pty-spawn', processId, harnessId: harnessId || '', label: label || cmd });
  return meta;
}

// ─── CLI Discovery ───────────────────────────────────────────────────────────

const MOCK_HELP_TEXT = [
  'mock harness usage:',
  '  --ticket <id>          target ticket id',
  '  --model <name>         claude-3-7-sonnet | gpt-4.5 | gemini-2.5-pro | o3 | deepseek-r1',
  '  --reasoning <level>    high | medium | low | unavailable',
  '  --heartbeat <seconds>  telemetry check interval (5..300)',
  '  --harness <id>         claude-code | zo | gemini-cli | codex | mock',
].join('\n');

const CLI_HARNESS_COMMANDS = {
  'claude-code': { cmd: 'npx', args: ['--yes', '@anthropic-ai/claude-code', '--help'] },
  'zo':          { cmd: 'node', args: [path.join(__dirname, '..', 'cli', 'zo.js')] },
  'gemini-cli':  { cmd: 'npx', args: ['--yes', '@google/gemini-cli', '--help'] },
  'codex':       { cmd: 'npx', args: ['--yes', '@openai/codex', '--help'] },
  'mock':        { cmd: 'node', args: ['-e', `process.stdout.write(${JSON.stringify(MOCK_HELP_TEXT)})`] },
};

// ─── CLI Hub version-check commands (TKT-ZAF-0019) ───────────────────────────
const CLI_HUB_VERSION_CMDS = {
  'claude-code': 'claude --version',
  'codex':       'codex --version',
  'antigravity': 'antigravity --version',
  'aider':       'aider --version',
  'goose':       'goose --version',
  'amp':         'amp --version',
};

function discoverCli(harnessId) {
  return new Promise(resolve => {
    const spec = CLI_HARNESS_COMMANDS[harnessId];
    if (!spec) return resolve({ ok: false, error: `Unknown harness "${harnessId}"`, models: [], flags: [], raw: '' });

    let raw = '';
    let resolved = false;
    const needShell = spec.cmd !== 'node' && process.platform === 'win32';
    const child = spawn(spec.cmd, spec.args, { shell: needShell, windowsHide: true });
    const finish = (ok) => {
      if (resolved) return;
      resolved = true;
      resolve({ ok, harnessId, raw, ...parseHelpOutput(raw) });
    };
    child.stdout.on('data', d => raw += d.toString());
    child.stderr.on('data', d => raw += d.toString());
    child.on('error', err => { raw += `\n[discover-error] ${err.message}`; finish(false); });
    child.on('close', () => finish(true));
    setTimeout(() => { try { child.kill(); } catch {} finish(false); }, 8000);
  });
}

function parseHelpOutput(raw) {
  const flags = [];
  const seenFlag = new Set();
  const flagRegex = /(?:^|\s)(--[a-z][\w-]*(?:\s+<[^>]+>)?)/gi;
  let m;
  while ((m = flagRegex.exec(raw)) !== null) {
    const f = m[1].trim();
    const key = f.split(/\s+/)[0];
    if (!seenFlag.has(key)) { seenFlag.add(key); flags.push(f); }
  }
  const models = [];
  const modelTokens = raw.match(/\b(claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|o[0-9][a-z0-9-]*|deepseek[a-z0-9-]*|sonnet[\w-]*|opus[\w-]*|haiku[\w-]*)/gi) || [];
  for (const t of modelTokens) {
    const cleaned = t.toLowerCase();
    if (!models.includes(cleaned)) models.push(cleaned);
  }
  return { flags: flags.slice(0, 40), models: models.slice(0, 40) };
}

// ─── Heartbeat sweeper (TKT-ZAF-0015) ────────────────────────────────────────

function getRetryScheduleMs() {
  return [30, 60, 180, 300].map(m => m * 60 * 1000);
}

setInterval(() => {
  for (const [id, entry] of processes.entries()) {
    if (entry.meta.status !== 'paused_rate_limit') continue;
    const schedule = getRetryScheduleMs();
    const retryIdx = entry.meta.retryCount || 0;
    if (retryIdx >= schedule.length) {
      entry.meta.status = 'blocked_budget';
      broadcast({ event: 'process.end', meta: entry.meta });
      auditAppend({ kind: 'process.blocked_budget', processId: id, ticketId: entry.meta.ticketId });
      continue;
    }
    const jitter = 1 + (Math.random() - 0.5) * 0.5;
    const waitMs = schedule[retryIdx] * jitter;
    const elapsed = Date.now() - (entry.meta.pausedAt || entry.meta.startTime);
    if (elapsed >= waitMs) {
      const newRetryCount = retryIdx + 1;
      auditAppend({ kind: 'process.retry', processId: id, retryCount: newRetryCount, ticketId: entry.meta.ticketId });
      broadcast({ event: 'process.retry', processId: id, retryCount: newRetryCount });
      spawnAgent({
        ticketId: entry.meta.ticketId,
        role: entry.meta.role,
        harness: entry.meta.harness,
        modelId: entry.meta.modelId,
        reasoning: entry.meta.reasoning,
        heartbeat: entry.meta.heartbeat,
        repoId: entry.meta.repoId,
        retryCount: newRetryCount,
      });
    }
  }
}, 60 * 1000);

// ─── TICKETS.md index update helper ─────────────────────────────────────────

function updateTicketsIndexRow(indexFile, ticketId, newStatus, today) {
  if (!fs.existsSync(indexFile)) return;
  let idx = fs.readFileSync(indexFile, 'utf8');
  const lines = idx.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('|');
    // cells[0]='' cells[1]=ID cells[2]=title cells[3]=prog cells[4]=ws cells[5]=status ...
    if (cells.length >= 2 && cells[1].trim() === ticketId) {
      if (cells.length >= 6) cells[5] = ` ${newStatus} `;
      // Last date column: cells[cells.length-2] (before trailing empty cell)
      if (cells.length >= 3) cells[cells.length - 2] = ` ${today} `;
      lines[i] = cells.join('|');
      break;
    }
  }
  fs.writeFileSync(indexFile, lines.join('\n'), 'utf8');
}

// ─── HTTP server ─────────────────────────────────────────────────────────────

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── SSE watch ──────────────────────────────────────────────────────────────
  if (pathname === '/api/watch') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: {"event":"connected"}\n\n');
    // Replay process list + PTY buffer so late-joining clients catch up
    for (const { meta, buffer } of processes.values()) {
      res.write(`data: ${JSON.stringify({ event: 'process.start', meta })}\n\n`);
      for (const chunk of buffer) {
        res.write(`data: ${JSON.stringify({ event: 'process.pty', processId: meta.processId, data: chunk.data, ts: chunk.ts })}\n\n`);
      }
    }
    const client = { res };
    sseClients.push(client);
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { clearInterval(hb); } }, 25000);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== client); clearInterval(hb); });
    return;
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  if (pathname === '/api/data') {
    runParse();
    try { send(res, 200, fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { send(res, 500, { error: 'data.json missing — parse failed' }); }
    return;
  }

  // ── Config GET (PAT scrubbed — never returned after save) ─────────────────
  if (pathname === '/api/config') {
    try {
      const conf = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (conf.github?.pat) conf.github.pat = '•••••';
      send(res, 200, JSON.stringify(conf, null, 2));
    } catch { send(res, 500, { error: 'config.json read failed' }); }
    return;
  }

  // ── Config SAVE ────────────────────────────────────────────────────────────
  if (pathname === '/api/config/save' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      writeConfig(payload);
      auditAppend({ kind: 'config.save', summary: 'config.json overwritten via dashboard' });
      send(res, 200, { status: 'ok' });
    } catch (e) { send(res, 400, { error: 'Bad JSON: ' + e.message }); }
    return;
  }

  // ── Run agent ──────────────────────────────────────────────────────────────
  if (pathname === '/api/run') {
    const launch = async () => {
      let payload = { ...parsed.query };
      if (req.method === 'POST') {
        try { payload = { ...payload, ...(await readJsonBody(req)) }; } catch {}
      }
      if (!payload.ticket) return send(res, 400, { error: 'Missing ticket' });
      const meta = spawnAgent({
        ticketId:       payload.ticket,
        role:           payload.role           || 'engineering',
        harness:        payload.harness        || 'mock',
        modelId:        payload.modelId        || payload.model || '',
        reasoning:      payload.reasoning      || '',
        heartbeat:      payload.heartbeat      || '',
        repoId:         payload.repo           || '',
        promptAddendum: payload.promptAddendum || '',
      });
      send(res, 200, { status: 'spawned', processId: meta.processId, meta });
    };
    launch();
    return;
  }

  // ── Process list ───────────────────────────────────────────────────────────
  if (pathname === '/api/processes') {
    send(res, 200, { processes: Array.from(processes.values()).map(p => p.meta) });
    return;
  }

  // ── Process buffer ─────────────────────────────────────────────────────────
  if (pathname === '/api/process/buffer') {
    const id = parsed.query.id;
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    send(res, 200, { meta: entry.meta, buffer: entry.buffer, isPty: true });
    return;
  }

  // ── Process kill ───────────────────────────────────────────────────────────
  if (pathname === '/api/process/kill') {
    const id = parsed.query.id;
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    try {
      if (entry.prefireTimer) { clearTimeout(entry.prefireTimer); entry.prefireTimer = null; }
      entry.proc.kill();
      auditAppend({ kind: 'process.kill', processId: id, ticketId: entry.meta.ticketId });
      send(res, 200, { status: 'killing' });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── Process clear ──────────────────────────────────────────────────────────
  if (pathname === '/api/process/clear') {
    for (const [id, entry] of processes.entries()) {
      if (entry.meta.status !== 'running' && entry.meta.status !== 'pre-fire') processes.delete(id);
    }
    broadcast({ event: 'process.cleared' });
    send(res, 200, { status: 'ok' });
    return;
  }

  // ── Process steer (TKT-ZAF-0014) ──────────────────────────────────────────
  const steerMatch = pathname.match(/^\/api\/process\/([^/]+)\/steer$/);
  if (steerMatch && req.method === 'POST') {
    const id = steerMatch[1];
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    try {
      const payload = await readJsonBody(req);
      // Accept either base64-encoded bytes or plain text
      const bytes = payload.data ? Buffer.from(payload.data, 'base64').toString() : (payload.text || '');
      entry.proc.write(bytes);
      auditAppend({ kind: 'operator.steer', processId: id, ticketId: entry.meta.ticketId, summary: bytes.slice(0, 200) });
      send(res, 200, { status: 'ok' });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── Process interrupt — sends Ctrl+C (TKT-ZAF-0014) ──────────────────────
  const interruptMatch = pathname.match(/^\/api\/process\/([^/]+)\/interrupt$/);
  if (interruptMatch && req.method === 'POST') {
    const id = interruptMatch[1];
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    try {
      entry.proc.write('\x03');
      auditAppend({ kind: 'operator.interrupt', processId: id, ticketId: entry.meta.ticketId });
      send(res, 200, { status: 'ok' });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── Process terminate — kill + append Handoff Log (TKT-ZAF-0014) ─────────
  const terminateMatch = pathname.match(/^\/api\/process\/([^/]+)\/terminate$/);
  if (terminateMatch && req.method === 'POST') {
    const id = terminateMatch[1];
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    try {
      if (entry.prefireTimer) { clearTimeout(entry.prefireTimer); entry.prefireTimer = null; }
      // Append termination note to ticket Handoff Log
      const today = new Date().toISOString().slice(0, 10);
      const ticketPath = path.join(REPOS_ROOT, entry.meta.repoId || 'zo-agentic-framework', 'WIP', 'tickets', 'ACTIVE', `${entry.meta.ticketId}.md`);
      try {
        let content = fs.readFileSync(ticketPath, 'utf8');
        const logEntry = `\n- ${today} | operator | TERMINATED — killed mid-run from ZAF control plane.`;
        content = content + logEntry;
        fs.writeFileSync(ticketPath, content, 'utf8');
      } catch {}
      entry.proc.kill();
      auditAppend({ kind: 'operator.terminate', processId: id, ticketId: entry.meta.ticketId });
      send(res, 200, { status: 'ok' });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── Process pause pre-fire (TKT-ZAF-0014) ─────────────────────────────────
  const pausePrefireMatch = pathname.match(/^\/api\/process\/([^/]+)\/pause-prefire$/);
  if (pausePrefireMatch && req.method === 'POST') {
    const id = pausePrefireMatch[1];
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    if (entry.prefireTimer) {
      clearTimeout(entry.prefireTimer);
      entry.prefireTimer = null;
      entry.meta.status = 'pre-fire-paused';
      auditAppend({ kind: 'operator.pause_prefire', processId: id, ticketId: entry.meta.ticketId });
      broadcast({ event: 'process.prefire_paused', processId: id, meta: entry.meta });
      send(res, 200, { status: 'ok' });
    } else {
      send(res, 400, { error: 'no pending pre-fire' });
    }
    return;
  }

  // ── Process resize PTY ─────────────────────────────────────────────────────
  const resizeMatch = pathname.match(/^\/api\/process\/([^/]+)\/resize$/);
  if (resizeMatch && req.method === 'POST') {
    const id = resizeMatch[1];
    const entry = processes.get(id);
    if (!entry) return send(res, 404, { error: 'unknown processId' });
    try {
      const payload = await readJsonBody(req);
      entry.proc.resize(Math.max(10, parseInt(payload.cols, 10) || 220), Math.max(5, parseInt(payload.rows, 10) || 50));
      send(res, 200, { status: 'ok' });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── Ticket status change ───────────────────────────────────────────────────
  const ticketStatusMatch = pathname.match(/^\/api\/ticket\/([^/]+)\/status$/);
  if (ticketStatusMatch && req.method === 'POST') {
    try {
      const ticketId = ticketStatusMatch[1];
      const payload = await readJsonBody(req);
      const { status: newStatus, repo } = payload;
      if (!newStatus) return send(res, 400, { error: 'status required' });
      const repoSlug = repo || 'zo-agentic-framework';
      const activeDir = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ACTIVE');
      const ticketPath = path.join(activeDir, `${ticketId}.md`);
      if (!fs.existsSync(ticketPath)) return send(res, 404, { error: 'ticket not found in ACTIVE/' });
      let content = fs.readFileSync(ticketPath, 'utf8');
      const today = new Date().toISOString().slice(0, 10);
      content = content.replace(/^status:.*$/m, `status: ${newStatus}`);
      content = content.replace(/^updated:.*$/m, `updated: ${today}`);
      const logEntry = `\n- ${today} | operator | Status changed to ${newStatus} via Control Plane.`;
      content = content + logEntry;
      fs.writeFileSync(ticketPath, content, 'utf8');
      // Update TICKETS.md index row
      const indexFile = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'TICKETS.md');
      updateTicketsIndexRow(indexFile, ticketId, newStatus, today);
      runParse();
      pushReload();
      send(res, 200, { status: 'ok', ticketId, newStatus });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── Ticket archive ─────────────────────────────────────────────────────────
  const ticketArchiveMatch = pathname.match(/^\/api\/ticket\/([^/]+)\/archive$/);
  if (ticketArchiveMatch && req.method === 'POST') {
    try {
      const ticketId = ticketArchiveMatch[1];
      const payload = await readJsonBody(req);
      const repoSlug = payload.repo || 'zo-agentic-framework';
      const activeDir  = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ACTIVE');
      const archivedDir = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ARCHIVED');
      const ticketPath = path.join(activeDir, `${ticketId}.md`);
      if (!fs.existsSync(ticketPath)) return send(res, 404, { error: 'ticket not found in ACTIVE/' });
      if (!fs.existsSync(archivedDir)) fs.mkdirSync(archivedDir, { recursive: true });
      let content = fs.readFileSync(ticketPath, 'utf8');
      const today = new Date().toISOString().slice(0, 10);
      if (!/^status:\s*DONE/m.test(content)) {
        content = content.replace(/^status:.*$/m, 'status: DONE');
      }
      content = content.replace(/^updated:.*$/m, `updated: ${today}`);
      content = content + `\n- ${today} | operator | Archived via Control Plane.`;
      fs.writeFileSync(path.join(archivedDir, `${ticketId}.md`), content, 'utf8');
      fs.unlinkSync(ticketPath);
      const indexFile = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'TICKETS.md');
      updateTicketsIndexRow(indexFile, ticketId, 'DONE', today);
      runParse();
      pushReload();
      send(res, 200, { status: 'ok', ticketId, archived: true });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── Ticket void ────────────────────────────────────────────────────────────
  const ticketVoidMatch = pathname.match(/^\/api\/ticket\/([^/]+)\/void$/);
  if (ticketVoidMatch && req.method === 'POST') {
    try {
      const ticketId = ticketVoidMatch[1];
      const payload = await readJsonBody(req);
      const repoSlug = payload.repo || 'zo-agentic-framework';
      const activeDir  = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ACTIVE');
      const archivedDir = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ARCHIVED');
      const ticketPath = path.join(activeDir, `${ticketId}.md`);
      if (!fs.existsSync(ticketPath)) return send(res, 404, { error: 'ticket not found in ACTIVE/' });
      if (!fs.existsSync(archivedDir)) fs.mkdirSync(archivedDir, { recursive: true });
      let content = fs.readFileSync(ticketPath, 'utf8');
      const today = new Date().toISOString().slice(0, 10);
      content = content.replace(/^status:.*$/m, 'status: VOIDED');
      content = content.replace(/^updated:.*$/m, `updated: ${today}`);
      content = content + `\n- ${today} | operator | VOIDED — operator decision via Control Plane.`;
      fs.writeFileSync(path.join(archivedDir, `${ticketId}.md`), content, 'utf8');
      fs.unlinkSync(ticketPath);
      const indexFile = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'TICKETS.md');
      updateTicketsIndexRow(indexFile, ticketId, 'VOIDED', today);
      runParse();
      pushReload();
      send(res, 200, { status: 'ok', ticketId, voided: true });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── Programme create ───────────────────────────────────────────────────────
  if (pathname === '/api/programme/create' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      if (!payload.title) return send(res, 400, { error: 'title required' });
      const repoSlug = payload.repo || 'zo-agentic-framework';
      const indexFile = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'TICKETS.md');
      if (!fs.existsSync(indexFile)) return send(res, 404, { error: 'TICKETS.md not found' });
      const phaseLabel = payload.phase || 'P-NEW';
      const progId = payload.programmeId || `PROG-${Date.now()}`;
      const wsId = payload.workstream || 'WS-UX';
      const newSection = `\n### ${phaseLabel} — ${payload.title}\n\n| ID | Title | Programme | Workstream | Status | Priority | Size | Updated |\n|---|---|---|---|---|---|---|---|\n`;
      let idx = fs.readFileSync(indexFile, 'utf8');
      // Insert before the first ## that is not the ## Active Tickets header
      const insertMarker = '\n## Ticket File Convention';
      if (idx.includes(insertMarker)) {
        idx = idx.replace(insertMarker, newSection + insertMarker);
      } else {
        idx = idx + newSection;
      }
      fs.writeFileSync(indexFile, idx, 'utf8');
      runParse();
      pushReload();
      send(res, 200, { status: 'ok', programmeId: progId });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  if (pathname === '/api/audit') {
    const limit = parseInt(parsed.query.limit || '500', 10);
    const kind = parsed.query.kind || '';
    let entries = auditRead(limit);
    if (kind) entries = entries.filter(e => (e.kind || '').startsWith(kind));
    send(res, 200, { entries });
    return;
  }

  // ── CLI capability discovery ───────────────────────────────────────────────
  if (pathname === '/api/cli/discover') {
    const result = await discoverCli(parsed.query.harness || 'claude-code');
    send(res, 200, result);
    return;
  }

  // ── Sync trigger ───────────────────────────────────────────────────────────
  if (pathname === '/api/trigger-sync') {
    pushReload();
    send(res, 200, { status: 'ok' });
    return;
  }

  // ── Ticket create ──────────────────────────────────────────────────────────
  if (pathname === '/api/ticket/create' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      if (!payload.title) return send(res, 400, { error: 'Missing title' });
      const repoSlug = payload.repo || 'zo-agentic-framework';
      const activeDir = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ACTIVE');
      const archivedDir = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'ARCHIVED');
      const indexFile = path.join(REPOS_ROOT, repoSlug, 'WIP', 'tickets', 'TICKETS.md');
      if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true });

      const allFiles = []
        .concat(fs.existsSync(activeDir)   ? fs.readdirSync(activeDir)   : [])
        .concat(fs.existsSync(archivedDir) ? fs.readdirSync(archivedDir) : []);
      const prefix = repoSlug === 'zo' ? 'TKT' : 'TKT-ZAF';
      let maxNum = 0;
      const matchRegex = new RegExp(`^${prefix}-(\\d+)\\.md$`, 'i');
      for (const f of allFiles) {
        const m = f.match(matchRegex);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
      const ticketId = `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
      const today = new Date().toISOString().slice(0, 10);

      const ticketContent = `---
id: ${ticketId}
title: ${payload.title}
status: OPEN
programme: ${payload.programme || (repoSlug === 'zo' ? 'PROG-001' : 'PROG-ZAF-001')}
workstream: ${payload.workstream || 'none'}
phase: ${payload.phase || 'P3'}
priority: ${payload.priority || 'P2'}
project: ${repoSlug === 'zo' ? 'ZO Migration' : 'ZO Agentic Framework'}
repo: ${repoSlug}
team: ${payload.team || 'engineering'}
roles: [${payload.role || 'engineering'}]
archetype: ${payload.archetype || 'BUILD'}
blocks: []
blocked_by: []
created: ${today}
updated: ${today}
usage_checkpoint: ${payload.usage_checkpoint || 'LOW'}
---

## Context

${payload.description || 'Task context and description.'}

## Task

1. Scaffold and build features.

## Acceptance Criteria

- [ ] Command compiles and runs successfully.

## Handoff Log

- ${today} | operator | OPEN — Ticket created via Control Plane.
`;
      fs.writeFileSync(path.join(activeDir, `${ticketId}.md`), ticketContent, 'utf8');

      if (fs.existsSync(indexFile)) {
        let idxContent = fs.readFileSync(indexFile, 'utf8');
        const idxLines = idxContent.split(/\r?\n/);
        let headerIdx = -1;
        for (let i = 0; i < idxLines.length; i++) {
          if (idxLines[i].match(/^###\s+Phase/i)) { headerIdx = i; break; }
        }
        if (headerIdx !== -1) {
          let insertAt = headerIdx + 3;
          for (let j = headerIdx + 1; j < idxLines.length; j++) {
            if (idxLines[j].trim().startsWith('|') && idxLines[j].includes(prefix + '-')) insertAt = j + 1;
            if (idxLines[j].startsWith('## ')) break;
          }
          idxLines.splice(insertAt, 0, `| ${ticketId} | ${payload.title} | ${payload.programme || 'PROG'} | ${payload.workstream || 'none'} | OPEN | ${today} |`);
          fs.writeFileSync(indexFile, idxLines.join('\n'), 'utf8');
        }
      }

      auditAppend({ kind: 'ticket.create', ticketId, title: payload.title, repo: repoSlug });
      runParse();
      pushReload();
      send(res, 200, { status: 'ok', ticketId });
    } catch (e) { send(res, 400, { error: 'Bad payload: ' + e.message }); }
    return;
  }

  // ── Fleet run (B1) ────────────────────────────────────────────────────────
  if (pathname === '/api/fleet/run' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
      if (tickets.length === 0) return send(res, 400, { error: 'tickets array required' });

      const conf = readConfig();
      const maxConcurrent = conf?.fleet?.maxConcurrent || 3;
      const dispatched = [];
      const skipped = [];

      for (const t of tickets) {
        if (!t.ticketId) { skipped.push({ reason: 'missing ticketId', ...t }); continue; }
        if (dispatched.length >= maxConcurrent) { skipped.push({ reason: 'maxConcurrent reached', ...t }); continue; }
        const meta = spawnAgent({
          ticketId:  t.ticketId,
          role:      t.role      || 'engineering',
          harness:   t.harness   || 'mock',
          modelId:   t.modelId   || t.model || '',
          reasoning: t.reasoning || '',
          heartbeat: t.heartbeat || '',
          repoId:    t.repo      || '',
          isFleet: true,
        });
        if (meta.processId) {
          fleetProcessIds.add(meta.processId);
          dispatched.push(meta.processId);
        } else {
          skipped.push({ reason: meta.message || 'spawn failed', ...t });
        }
      }

      auditAppend({ kind: 'fleet.dispatch', dispatched, skipped: skipped.map(s => s.ticketId || '?'), maxConcurrent });
      send(res, 200, { dispatched, skipped });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── Fleet stop (B3) ───────────────────────────────────────────────────────
  if (pathname === '/api/fleet/stop' && req.method === 'POST') {
    const killed = [];
    for (const pid of fleetProcessIds) {
      const entry = processes.get(pid);
      if (!entry) continue;
      const s = entry.meta.status;
      if (s === 'running' || s === 'pre-fire' || s === 'paused_rate_limit') {
        try {
          if (entry.prefireTimer) { clearTimeout(entry.prefireTimer); entry.prefireTimer = null; }
          entry.proc.kill();
          killed.push(pid);
        } catch {}
      }
    }
    fleetProcessIds.clear();
    auditAppend({ kind: 'fleet.stop', killed });
    broadcast({ event: 'fleet.stop', killed });
    send(res, 200, { status: 'ok', killed });
    return;
  }

  // ── Fleet status (B2 helper) ───────────────────────────────────────────────
  if (pathname === '/api/fleet/status') {
    const fleet = Array.from(fleetProcessIds)
      .map(pid => processes.get(pid)?.meta)
      .filter(Boolean);
    send(res, 200, { fleet });
    return;
  }

  // ── Repo create (TKT-ZAF-0028) ────────────────────────────────────────────
  if (pathname === '/api/repo/create' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const { name, displayName, localPath, description, remoteUrl, mode, templateName, agentRole, agentHarness, scaffoldInstructions } = payload;
      if (!name || !localPath) return send(res, 400, { error: 'name and localPath required' });

      // 1. Create directory and git init
      fs.mkdirSync(localPath, { recursive: true });
      try { execSync('git init', { cwd: localPath, timeout: 10000, stdio: 'ignore' }); } catch {}

      // 2. Copy template files
      const templateRoot = path.join(__dirname, 'templates', 'new-repo');
      const tpl = templateName || 'minimal';
      const srcDir = path.join(templateRoot, tpl);
      if (fs.existsSync(srcDir)) {
        copyDirRecursive(srcDir, localPath);
      } else {
        // Fallback: write a minimal CLAUDE.md
        fs.writeFileSync(path.join(localPath, 'CLAUDE.md'), `# ${displayName || name}\n\n${description || ''}\n`, 'utf8');
      }

      // 3. Git remote add
      if (remoteUrl) {
        try { execSync(`git remote add origin "${remoteUrl}"`, { cwd: localPath, timeout: 5000, stdio: 'ignore' }); } catch {}
      }

      // 4. Update config.repos
      const conf = readConfig() || {};
      conf.repos = conf.repos || [];
      if (!conf.repos.find(r => r.id === name)) {
        conf.repos.push({ id: name, name: displayName || name, path: localPath });
        writeConfig(conf);
      }

      // 5. CLI-scaffold mode: create a ticket and dispatch the agent
      let ticketId = null;
      if (mode === 'cli-scaffold' && agentRole && agentHarness) {
        const activeDir = path.join(REPOS_ROOT, 'zo-agentic-framework', 'WIP', 'tickets', 'ACTIVE');
        if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true });
        const allFiles = fs.existsSync(activeDir) ? fs.readdirSync(activeDir) : [];
        let maxNum = 0;
        for (const f of allFiles) { const m = f.match(/^TKT-ZAF-(\d+)\.md$/i); if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10)); }
        ticketId = `TKT-ZAF-${String(maxNum + 1).padStart(4, '0')}`;
        const today = new Date().toISOString().slice(0, 10);
        const tktContent = `---\nid: ${ticketId}\ntitle: Scaffold new repo ${name}\nstatus: OPEN\nprogramme: PROG-ZAF-001\nworkstream: WS-CLI\nphase: P8\npriority: P2\nproject: ZO Agentic Framework\nrepo: zo-agentic-framework\nteam: engineering\nroles: [${agentRole}]\narchetype: BUILD\nblocks: []\nblocked_by: []\ncreated: ${today}\nupdated: ${today}\nusage_checkpoint: LOW\n---\n\n## Context\n\nScaffold new repository: ${name} (${displayName || name})\nPath: ${localPath}\n${description ? `Description: ${description}\n` : ''}\n## Task\n\n${scaffoldInstructions || 'Initialize the repository with proper ZAF standard structure.'}\n\n## Acceptance Criteria\n\n- [ ] Repository structure matches ZAF standard\n\n## Handoff Log\n\n- ${today} | operator | OPEN — Created via New Repo wizard.\n`;
        fs.writeFileSync(path.join(activeDir, `${ticketId}.md`), tktContent, 'utf8');
        spawnAgent({ ticketId, role: agentRole, harness: agentHarness, repoId: 'zo-agentic-framework' });
      }

      auditAppend({ kind: 'repo.create', name, localPath, mode: mode || 'manual', templateName: tpl });
      pushReload();
      send(res, 200, { status: 'ok', name, localPath, ticketId });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── CLI Hub: harness install/auth status (TKT-ZAF-0019) ──────────────────
  if (pathname === '/api/cli/status') {
    const harnessId = parsed.query.harness || '';
    const conf = readConfig() || {};
    let versionCmd = CLI_HUB_VERSION_CMDS[harnessId];
    if (!versionCmd) {
      const custom = (conf.customHarnesses || []).find(h => h.id === harnessId);
      if (custom) versionCmd = custom.versionCmd;
    }
    if (!versionCmd) return send(res, 400, { error: 'Unknown harness: ' + harnessId });
    let installed = false, version = '';
    try {
      const out = execSync(versionCmd, { timeout: 8000, shell: true }).toString().trim();
      installed = true;
      version = out.split(/\r?\n/)[0].slice(0, 80);
    } catch { installed = false; }
    send(res, 200, { harness: harnessId, installed, version });
    return;
  }

  // ── CLI Hub: spawn inline PTY (TKT-ZAF-0019) ──────────────────────────────
  if (pathname === '/api/pty/inline' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const { cmd, args, cwd, label, harnessId, kind } = payload;
      if (!cmd) return send(res, 400, { error: 'cmd required' });
      const meta = spawnInlinePty({ cmd, args: args || [], cwd: cwd || __dirname, label, harnessId, kind });
      send(res, 200, { status: 'spawned', processId: meta.processId, meta });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── CLI Hub: GitHub config save (TKT-ZAF-0019) ────────────────────────────
  if (pathname === '/api/config/github' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const { name, email, defaultRemote, authMethod, sshKeyPath, pat } = payload;
      if (!name && !email) return send(res, 400, { error: 'At least name or email required' });
      if (name) execSync(`git config --global user.name "${name.replace(/['"]/g, '')}"`, { timeout: 5000, shell: true });
      if (email) execSync(`git config --global user.email "${email.replace(/['"]/g, '')}"`, { timeout: 5000, shell: true });
      const conf = readConfig() || {};
      conf.github = conf.github || {};
      if (name)          conf.github.name          = name;
      if (email)         conf.github.email         = email;
      if (defaultRemote) conf.github.defaultRemote = defaultRemote;
      if (authMethod)    conf.github.authMethod    = authMethod;
      if (sshKeyPath)    conf.github.sshKeyPath    = sshKeyPath;
      if (pat)           conf.github.pat           = pat;
      writeConfig(conf);
      auditAppend({ kind: 'github.config-saved', name: name || '', email: email || '', authMethod: authMethod || '' });
      send(res, 200, { status: 'ok' });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── CLI Hub: register custom harness (TKT-ZAF-0019) ──────────────────────
  if (pathname === '/api/harness/custom' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const { displayName, installCmd, authCmd, versionCmd, modelIds } = payload;
      if (!displayName || !versionCmd) return send(res, 400, { error: 'displayName and versionCmd required' });
      const id = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const conf = readConfig() || {};
      conf.customHarnesses = conf.customHarnesses || [];
      if (conf.customHarnesses.find(h => h.id === id)) return send(res, 400, { error: 'Harness ID already exists: ' + id });
      const harness = {
        id, displayName,
        installCmd: installCmd || '',
        authCmd: authCmd || '',
        versionCmd,
        modelIds: modelIds ? modelIds.split(',').map(s => s.trim()).filter(Boolean) : [],
      };
      conf.customHarnesses.push(harness);
      writeConfig(conf);
      auditAppend({ kind: 'harness.custom-add', id, displayName });
      send(res, 200, { status: 'ok', id });
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  // ── Static files ───────────────────────────────────────────────────────────
  let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  const contentType = MIME[path.extname(filePath)] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
      else { res.writeHead(500); res.end('Server error'); }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── Boot ────────────────────────────────────────────────────────────────────

console.log(`\n╔═══════════════════════════════════════════╗`);
console.log(`║  ZAF Control Plane  (PTY-grade)           ║`);
console.log(`╚═══════════════════════════════════════════╝`);
console.log(`  Repos root : ${REPOS_ROOT}`);
console.log(`  Port       : ${PORT}`);

runParse();
migrateConfig();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ✓ Listening at http://localhost:${PORT}\n`);
  startWatcher();
  auditAppend({ kind: 'server.boot', port: PORT, reposRoot: REPOS_ROOT });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} in use. Set PORT to another port.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
