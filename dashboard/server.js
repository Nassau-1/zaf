/**
 * server.js — ZO WIP Dashboard v2
 * HTTP + SSE server: serves static files, parses WIP markdown, watches for changes.
 * Usage: node server.js [--port 4242] [--repos-root "C:\path\to\01_Repos"]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execSync, spawn } = require('child_process');
const chokidar = require('chokidar');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4242', 10);
const REPOS_ROOT = process.env.REPOS_ROOT ||
  path.resolve(__dirname, '../../');   // Resolves to 01_Repos/

const STATIC_DIR = __dirname;
const PARSE_SCRIPT = path.join(__dirname, 'parse.js');
const DATA_FILE = path.join(__dirname, 'data.json');

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ─── SSE clients ─────────────────────────────────────────────────────────────

let sseClients = [];

function pushReload() {
  const dead = [];
  for (const res of sseClients) {
    try {
      res.write('data: {"event":"reload"}\n\n');
    } catch {
      dead.push(res);
    }
  }
  sseClients = sseClients.filter(r => !dead.includes(r));
  console.log(`[SSE] Pushed reload to ${sseClients.length} client(s)`);
}

// ─── File watcher ─────────────────────────────────────────────────────────────

let debounceTimer = null;

function startWatcher() {
  // Watch all WIP markdown files across all repos
  const watchGlob = path.join(REPOS_ROOT, '*/WIP/**/*.md').replace(/\\/g, '/');
  console.log(`[WATCH] Watching: ${watchGlob}`);

  const watcher = chokidar.watch(watchGlob, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const trigger = (filepath) => {
    console.log(`[WATCH] Changed: ${path.relative(REPOS_ROOT, filepath)}`);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runParse();
      pushReload();
    }, 500);
  };

  watcher.on('add', trigger).on('change', trigger).on('unlink', trigger);
  watcher.on('error', err => console.error('[WATCH] Error:', err));
}

// ─── Parse runner ─────────────────────────────────────────────────────────────

function runParse() {
  try {
    console.log('[PARSE] Running...');
    execSync(`node "${PARSE_SCRIPT}" --repos-root "${REPOS_ROOT}"`, {
      cwd: __dirname,
      timeout: 30000,
      stdio: 'inherit',
    });
    console.log('[PARSE] Done.');
  } catch (err) {
    console.error('[PARSE] Error:', err.message);
  }
}

function spawnAgent(ticketId, role, harness, model, reasoning, heartbeat) {
  console.log(`[ZAF Control] Spawning agent for ticket ${ticketId}, role ${role}, harness ${harness}`);
  const zoScript = path.join(__dirname, '..', 'cli', 'zo.js');
  
  const args = [zoScript, 'run', role, '--ticket', ticketId, '--harness', harness];
  if (model) args.push('--model', model);
  if (reasoning) args.push('--reasoning', reasoning);
  if (heartbeat) args.push('--heartbeat', heartbeat);

  const child = spawn('node', args, {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PAGER: 'cat'
    }
  });

  const broadcastLog = (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim() === '') continue;
      const dataStr = JSON.stringify({ event: 'log', log: line });
      for (const res of sseClients) {
        try {
          res.write(`data: ${dataStr}\n\n`);
        } catch (e) {
          // Ignore
        }
      }
    }
  };

  child.stdout.on('data', broadcastLog);
  child.stderr.on('data', (chunk) => {
    broadcastLog('[stderr] ' + chunk);
  });

  child.on('close', (code) => {
    const exitMsg = `[ZAF Control] Subprocess harness terminated with exit code: ${code}`;
    console.log(exitMsg);
    broadcastLog(exitMsg);
    pushReload();
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── SSE endpoint ──────────────────────────────────────────────────────────
  if (pathname === '/api/watch') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: {"event":"connected"}\n\n');
    sseClients.push(res);
    console.log(`[SSE] Client connected (total: ${sseClients.length})`);

    // Heartbeat every 25s to keep connection alive
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 25000);

    req.on('close', () => {
      sseClients = sseClients.filter(r => r !== res);
      clearInterval(heartbeat);
      console.log(`[SSE] Client disconnected (total: ${sseClients.length})`);
    });
    return;
  }

  // ── Data endpoint ─────────────────────────────────────────────────────────
  if (pathname === '/api/data') {
    runParse();
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'data.json not found — parse failed' }));
    }
    return;
  }

  // ── Run endpoint ──────────────────────────────────────────────────────────
  if (pathname === '/api/run') {
    const ticketId = parsed.query.ticket || '';
    const role = parsed.query.role || 'engineering';
    const harness = parsed.query.harness || 'mock';
    const model = parsed.query.model || '';
    const reasoning = parsed.query.reasoning || '';
    const heartbeat = parsed.query.heartbeat || '';

    if (!ticketId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ticket ID parameter' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'spawning', ticket: ticketId, role, harness, model, reasoning, heartbeat }));

    // Spawn subprocess and stream output via SSE
    spawnAgent(ticketId, role, harness, model, reasoning, heartbeat);
    return;
  }

  // ── Sync endpoint ─────────────────────────────────────────────────────────
  if (pathname === '/api/trigger-sync') {
    pushReload();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', msg: 'Sync broadcasted' }));
    return;
  }

  // ── Get Config endpoint ───────────────────────────────────────────────────
  if (pathname === '/api/config') {
    const configPath = path.join(__dirname, 'config.json');
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read config.json' }));
    }
    return;
  }

  // ── Save Config endpoint ──────────────────────────────────────────────────
  if (pathname === '/api/config/save' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyData);
        const configPath = path.join(__dirname, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed POST JSON payload' }));
      }
    });
    return;
  }

  // ── Create Ticket endpoint ────────────────────────────────────────────────
  if (pathname === '/api/ticket/create' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyData);
        if (!payload.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing title parameter' }));
          return;
        }

        let maxNum = 0;
        const activeDir = path.join(REPOS_ROOT, 'zo-agentic-framework', 'WIP', 'tickets', 'ACTIVE');
        const archivedDir = path.join(REPOS_ROOT, 'zo-agentic-framework', 'WIP', 'tickets', 'ARCHIVED');
        const indexFile = path.join(REPOS_ROOT, 'zo-agentic-framework', 'WIP', 'tickets', 'TICKETS.md');

        if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true });

        const activeFiles = fs.existsSync(activeDir) ? fs.readdirSync(activeDir) : [];
        const archivedFiles = fs.existsSync(archivedDir) ? fs.readdirSync(archivedDir) : [];
        const allFiles = activeFiles.concat(archivedFiles);

        for (const f of allFiles) {
          const match = f.match(/TKT-ZAF-(\d+)\.md$/i);
          if (match) {
            maxNum = Math.max(maxNum, parseInt(match[1], 10));
          }
        }
        const nextNum = maxNum + 1;
        const ticketId = `TKT-ZAF-${String(nextNum).padStart(4, '0')}`;
        const currentDate = new Date().toISOString().slice(0, 10);
        
        const ticketContent = `---
id: ${ticketId}
title: ${payload.title}
status: OPEN
programme: PROG-ZAF-001
workstream: ${payload.workstream || 'none'}
phase: ${payload.phase || 'P3'}
priority: ${payload.priority || 'P2'}
project: ZO Agentic Framework
repo: ${payload.repo || 'zo-agentic-framework'}
team: engineering
roles: [${payload.role || 'antigravity-ide'}]
archetype: BUILD
blocks: []
blocked_by: []
created: ${currentDate}
updated: ${currentDate}
usage_checkpoint: LOW
---

## Context

${payload.description || 'Task context and description.'}

## Task

1.  Scaffold and build features.

## Acceptance Criteria

- [ ] Command compiles and runs successfully.

## Handoff Log

- ${currentDate} | operator | OPEN — Ticket created via Control Center.
`;

        fs.writeFileSync(path.join(activeDir, `${ticketId}.md`), ticketContent, 'utf8');

        // Update TICKETS.md index
        if (fs.existsSync(indexFile)) {
          let idxContent = fs.readFileSync(indexFile, 'utf8');
          const lines = idxContent.split(/\r?\n/);
          let pGateHeaderIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`### Phase 4 — Unified Control Interface`)) {
              pGateHeaderIdx = i;
              break;
            }
          }
          if (pGateHeaderIdx !== -1) {
            let lastRow = -1;
            for (let j = pGateHeaderIdx + 1; j < lines.length; j++) {
              if (lines[j].trim().startsWith('|') && lines[j].includes('TKT-ZAF-')) {
                lastRow = j;
              }
              if (lines[j].trim().startsWith('---') || (lines[j].trim().startsWith('##') && !lines[j].trim().startsWith('###'))) {
                break;
              }
            }
            const newRow = `| ${ticketId} | ${payload.title} | PROG-ZAF-001 | ${payload.workstream || 'none'} | OPEN | ${currentDate} |`;
            if (lastRow !== -1) {
              lines.splice(lastRow + 1, 0, newRow);
            } else {
              lines.splice(pGateHeaderIdx + 3, 0, newRow);
            }
            
            let nextIdNum = nextNum + 1;
            const nextIdStr = `TKT-ZAF-${String(nextIdNum).padStart(4, '0')}`;
            idxContent = lines.join('\n')
              .replace(/Next ticket number:\s*\*\*TKT-ZAF-\d+\*\*/g, `Next ticket number: **${nextIdStr}**`)
              .replace(/Next ticket number:\s*TKT-ZAF-\d+/g, `Next ticket number: ${nextIdStr}`);
            
            fs.writeFileSync(indexFile, idxContent, 'utf8');
          }
        }

        runParse();
        pushReload();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', ticketId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed POST JSON payload' }));
      }
    });
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // Safety check: don't serve files outside static dir
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

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

// ─── Boot ─────────────────────────────────────────────────────────────────────

console.log(`\n╔═══════════════════════════════════════════╗`);
console.log(`║  ZO WIP Dashboard v2                      ║`);
console.log(`╚═══════════════════════════════════════════╝`);
console.log(`  Repos root : ${REPOS_ROOT}`);
console.log(`  Port       : ${PORT}`);

// Initial parse
runParse();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ✓ Listening at http://localhost:${PORT}\n`);
  startWatcher();
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use. Set PORT env var to use a different port.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
