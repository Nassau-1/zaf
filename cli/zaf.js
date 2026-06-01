#!/usr/bin/env node

/**
 * ZAF CLI (zaf.js)
 * Command-line control plane for ZAF, the Zero-to-one Agent Framework.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ZAF_BANNER = String.raw`
███████╗ █████╗ ███████╗
╚══███╔╝██╔══██╗██╔════╝
  ███╔╝ ███████║█████╗
 ███╔╝  ██╔══██║██╔══╝
███████╗██║  ██║██║
╚══════╝╚═╝  ╚═╝╚═╝

Zero-to-one Agent Framework
`;

function printBanner() {
  console.log(ZAF_BANNER);
}

function printHelp() {
  printBanner();
  console.log(`
Usage:
  zaf ticket status <TKT-ID>            Parse and show the status of a ticket
  zaf ticket create "<title>"           Scaffold and index a new ticket
  zaf run <role> --ticket <TKT-ID> [--harness <mock|claude-code|codex|gemini-cli>]
                                        Launch an agent harness against a ticket

Examples:
  zaf ticket status TKT-ZAF-0005
  zaf ticket create "Scaffold CLI interface"
  zaf run engineering --ticket TKT-ZAF-0005 --harness mock
`);
}

// Repo Root Auto-Discovery

function findRepoRoot(startDir = process.cwd(), fileExists = fs.existsSync) {
  let current = startDir;
  while (true) {
    const ticketsIndex = path.join(current, 'WIP', 'tickets', 'TICKETS.md');
    if (fileExists(ticketsIndex)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const ACTIVE_DIR = path.join(REPO_ROOT, 'WIP', 'tickets', 'ACTIVE');
const ARCHIVED_DIR = path.join(REPO_ROOT, 'WIP', 'tickets', 'ARCHIVED');
const TICKETS_INDEX_PATH = path.join(REPO_ROOT, 'WIP', 'tickets', 'TICKETS.md');

function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const yamlText = match[1];
  const body = match[2];
  const data = {};
  for (const line of yamlText.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      } else {
        val = val.replace(/^['"]|['"]$/g, '');
      }
      data[key] = val;
    }
  }
  return { data, body };
}

function getLastHandoffLog(body) {
  const lines = body.split(/\r?\n/);
  let inHandoff = false;
  const handoffs = [];
  for (const line of lines) {
    if (line.match(/^##\s+Handoff\s+Log/i)) {
      inHandoff = true;
      continue;
    }
    if (inHandoff) {
      if (line.match(/^##\s+/)) {
        break;
      }
      if (line.trim().startsWith('-')) {
        handoffs.push(line.trim());
      }
    }
  }
  return handoffs.length > 0 ? handoffs[handoffs.length - 1] : 'No handoff logs found.';
}

function getFormattedDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRoleProfile(role) {
  const taxonomyPath = path.join(REPO_ROOT, 'docs', 'agent-taxonomy.md');
  if (!fs.existsSync(taxonomyPath)) {
    return `*   **Role**: ${role}\n*   **Taxonomy File**: Missing from docs/agent-taxonomy.md`;
  }
  try {
    const content = fs.readFileSync(taxonomyPath, 'utf8');
    const normalizedRole = role.toLowerCase().replace(/[^a-z]/g, '');
    const mappings = [
      { key: 'coo', search: 'chief operating officer' },
      { key: 'engineering', search: 'engineering core' },
      { key: 'testing', search: 'quality & testing' },
      { key: 'quality', search: 'quality & testing' },
      { key: 'data', search: 'data & ai specialist' },
      { key: 'ai', search: 'data & ai specialist' },
      { key: 'security', search: 'security specialist' },
      { key: 'sre', search: 'site reliability engineer' }
    ];
    let matchedSearch = normalizedRole;
    for (const map of mappings) {
      if (normalizedRole.includes(map.key) || map.key.includes(normalizedRole)) {
        matchedSearch = map.search;
        break;
      }
    }
    const lines = content.split(/\r?\n/);
    let startIdx = -1;
    let headerName = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#') && line.toLowerCase().includes(matchedSearch)) {
        startIdx = i;
        headerName = line.replace(/^#+\s+/, '');
        break;
      }
    }
    if (startIdx === -1) {
      return `*   **Role**: ${role} (profile not found in agent-taxonomy.md)`;
    }
    let profileLines = [];
    for (let j = startIdx + 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.startsWith('---')) {
        break;
      }
      profileLines.push(line);
    }
    return `### Role Profile: ${headerName}\n\n${profileLines.join('\n').trim()}`;
  } catch (err) {
    return `*   **Role**: ${role}\n*   **Parser Warning**: Failed to parse agent-taxonomy.md dynamically (${err.message})`;
  }
}

function handleTicketStatus(ticketId) {
  if (!ticketId) {
    console.error('Error: Please specify a ticket ID (e.g. TKT-ZAF-0005)');
    process.exit(1);
  }
  let formattedId = ticketId.toUpperCase();
  if (!formattedId.startsWith('TKT-')) {
    formattedId = `TKT-ZAF-${formattedId.padStart(4, '0')}`;
  }
  let filePath = path.join(ACTIVE_DIR, `${formattedId}.md`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ARCHIVED_DIR, `${formattedId}.md`);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Ticket ${formattedId} not found in ACTIVE or ARCHIVED.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontMatter(raw);
  const lastHandoff = getLastHandoffLog(body);

  console.log(`\n======================================================`);
  console.log(`TICKET: ${data.id || formattedId}`);
  console.log(`======================================================`);
  console.log(`Title:      ${data.title || 'N/A'}`);
  console.log(`Status:     ${data.status || 'OPEN'}`);
  console.log(`Workstream: ${data.workstream || 'none'}`);
  console.log(`Phase:      ${data.phase || 'N/A'}`);
  console.log(`Priority:   ${data.priority || 'N/A'}`);
  console.log(`Repo:       ${data.repo || 'N/A'}`);
  console.log(`Roles:      ${Array.isArray(data.roles) ? data.roles.join(', ') : 'N/A'}`);
  console.log(`Blocks:     ${Array.isArray(data.blocks) ? data.blocks.join(', ') : 'none'}`);
  console.log(`Blocked By: ${Array.isArray(data.blocked_by) ? data.blocked_by.join(', ') : 'none'}`);
  console.log(`------------------------------------------------------`);
  console.log(`Last Handoff Log Entry:`);
  console.log(`   ${lastHandoff}`);
  console.log(`======================================================\n`);
}

function handleTicketCreate(title) {
  if (!title) {
    console.error('Error: Please specify a ticket title enclosed in quotes.');
    process.exit(1);
  }
  let maxNum = 0;
  try {
    const activeFiles = fs.existsSync(ACTIVE_DIR) ? fs.readdirSync(ACTIVE_DIR) : [];
    const archivedFiles = fs.existsSync(ARCHIVED_DIR) ? fs.readdirSync(ARCHIVED_DIR) : [];
    const allFiles = activeFiles.concat(archivedFiles);
    for (const f of allFiles) {
      const match = f.match(/TKT-ZAF-(\d+)\.md$/i);
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    }
  } catch (err) {
    console.warn('Warning: Failed scanning directories, defaulting sequencing.');
  }
  const nextNum = maxNum + 1;
  const nextId = `TKT-ZAF-${String(nextNum).padStart(4, '0')}`;
  const currentDate = getFormattedDate();
  const ticketContent = `---
id: ${nextId}
title: ${title}
status: OPEN
programme: PROG-ZAF-001
workstream: none
phase: P3
priority: P2
project: ZAF
repo: zaf
team: engineering
roles: [engineering]
archetype: BUILD
blocks: []
blocked_by: []
created: ${currentDate}
updated: ${currentDate}
usage_checkpoint: LOW
---

## Context

Task context and descriptive background information goes here.

## Task

1.  Scaffold and build features.

## Acceptance Criteria

- [ ] Command compiles and runs successfully.

## Handoff Log

- ${currentDate} | operator | OPEN. Ticket created.
`;

  const newFilePath = path.join(ACTIVE_DIR, `${nextId}.md`);
  if (!fs.existsSync(ACTIVE_DIR)) {
    fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  }
  fs.writeFileSync(newFilePath, ticketContent, 'utf8');
  console.log(`Created ticket file: WIP/tickets/ACTIVE/${nextId}.md`);

  if (fs.existsSync(TICKETS_INDEX_PATH)) {
    let indexContent = fs.readFileSync(TICKETS_INDEX_PATH, 'utf8');
    const lines = indexContent.split(/\r?\n/);
    let p3HeaderIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('### Phase 3 — CLI Integration')) {
        p3HeaderIdx = i;
        break;
      }
    }
    if (p3HeaderIdx !== -1) {
      let insertIdx = -1;
      for (let j = p3HeaderIdx + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim().startsWith('---') || (line.trim().startsWith('##') && !line.trim().startsWith('###'))) {
          insertIdx = j;
          break;
        }
      }
      if (insertIdx === -1) {
        insertIdx = lines.length;
      }
      let lastTableRow = -1;
      for (let j = p3HeaderIdx + 1; j < insertIdx; j++) {
        if (lines[j].trim().startsWith('|') && lines[j].includes('TKT-ZAF-')) {
          lastTableRow = j;
        }
      }
      const newTableRow = `| ${nextId} | ${title} | PROG-ZAF-001 | none | OPEN | ${currentDate} |`;
      if (lastTableRow !== -1) {
        lines.splice(lastTableRow + 1, 0, newTableRow);
      } else {
        let headerBoundary = p3HeaderIdx + 3;
        lines.splice(headerBoundary, 0, newTableRow);
      }
      let nextIdNum = nextNum + 1;
      const nextIdStr = `TKT-ZAF-${String(nextIdNum).padStart(4, '0')}`;
      indexContent = lines.join('\n');
      indexContent = indexContent.replace(/Next ticket number:\s*\*\*TKT-ZAF-\d+\*\*/g, `Next ticket number: **${nextIdStr}**`);
      indexContent = indexContent.replace(/Next ticket number:\s*TKT-ZAF-\d+/g, `Next ticket number: ${nextIdStr}`);
      fs.writeFileSync(TICKETS_INDEX_PATH, indexContent, 'utf8');
      console.log(`Updated ticket index: WIP/tickets/TICKETS.md`);
    } else {
      console.warn('Warning: Phase 3 header not found in TICKETS.md, skipped indexing.');
    }
  } else {
    console.warn('Warning: TICKETS.md index file not found, skipped indexing.');
  }
}

function handleRun(role, ticketId, harnessOption, model, reasoning, heartbeat) {
  if (!role || !ticketId) {
    console.error('Error: Usage: zaf run <role> --ticket <TKT-ID> [--harness <name>]');
    process.exit(1);
  }
  let formattedId = ticketId.toUpperCase();
  if (!formattedId.startsWith('TKT-')) {
    formattedId = `TKT-ZAF-${formattedId.padStart(4, '0')}`;
  }
  const filePath = path.join(ACTIVE_DIR, `${formattedId}.md`);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Active ticket ${formattedId} not found in ${ACTIVE_DIR}.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontMatter(raw);
  const lastHandoff = getLastHandoffLog(body);
  const repoName = data.repo || path.basename(REPO_ROOT);
  const harness = harnessOption || 'claude';

  console.log(`\n======================================================`);
  console.log(`ZAF AGENT HARNESS RUNNER`);
  console.log(`======================================================`);
  console.log(`Active Ticket: ${formattedId}`);
  console.log(`Assigned Role: ${role}`);
  console.log(`Harness:       ${harness}`);
  console.log(`Repository:    ${repoName}`);
  if (model) console.log(`Target Model:  ${model}`);
  if (reasoning) console.log(`Reasoning:     ${reasoning}`);
  if (heartbeat) console.log(`Heartbeat:     ${heartbeat}s`);
  console.log(`======================================================\n`);

  const transientSkillPath = path.join(REPO_ROOT, '.zaf-skill.md');
  const roleProfile = getRoleProfile(role);

  const skillBlueprint = `# ZAF HARNESS SYSTEM SKILL

> You are executing under the ZAF (Zero-to-one Agent Framework) control plane. Follow these operational constraints.

## 1. Active Task Context
*   **Target Ticket ID**: ${formattedId}
*   **Target Repository**: ${repoName}
*   **Assigned Role Profile**: ${role}
*   **Ticket Title**: ${data.title || 'N/A'}
*   **Last Handoff Summary**: ${lastHandoff}
*   **Assigned Model**: ${model || 'default'}
*   **Reasoning Level**: ${reasoning || 'default'}
*   **Heartbeat Interval**: ${heartbeat || '40'}s

## 2. Dynamic Agent Persona & Boundaries
${roleProfile}

## 3. Directory Mounts & Write Authorities
You are authorised to read and write files ONLY within the following boundaries:
*   **Repository Root (Writable)**: \`${path.resolve(REPO_ROOT)}\`
*   **Active Tickets (Append-Only logs/Status)**: \`${ACTIVE_DIR}\`
*   **System configurations & vault credentials**: Read-only / Unauthorised.

## 4. Operational Constraints
1.  **Ticket State Modification**:
    *   Do not delete ticket files.
    *   To complete this task, rewrite the metadata front-matter status at the top of \`WIP/tickets/ACTIVE/${formattedId}.md\` from \`status: IN_PROGRESS\` (or other status) to \`status: DONE\`.
2.  **Standard Handoff Logging**:
    *   Before finishing your execution, append a new chronological log entry to the \`## Handoff Log\` at the bottom of the active ticket.
    *   Format: \`- YYYY-MM-DD | ${role} | DONE. [Your work description and remaining steps]\`.
3.  **Strict File Scoping**:
    *   You may only write or modify files under the target repository folder.
    *   System files, vault secrets, and root settings are read-only.
4.  **No Guessing**:
    *   If you encounter a missing credential, an ambiguous requirement, or a policy question, do not guess.
    *   Stop, change the ticket status to \`status: BLOCKED\`, log the specific blocker details in the Handoff Log, and alert the operator.
`;

  fs.writeFileSync(transientSkillPath, skillBlueprint, 'utf8');
  console.log(`Injected transient skill overlay: .zaf-skill.md`);

  const HARNESS_MAP = {
    'claude-code': { cmd: 'npx', args: ['-y', '@anthropic-ai/claude-code'], label: 'Claude Code CLI', requiresTTY: true },
    'claude':      { cmd: 'npx', args: ['-y', '@anthropic-ai/claude-code'], label: 'Claude Code CLI', requiresTTY: true },
    'codex':       { cmd: 'npx', args: ['-y', '@openai/codex'],             label: 'OpenAI Codex CLI', requiresTTY: true },
    'gemini-cli':  { cmd: 'npx', args: ['-y', '@google/gemini-cli'],        label: 'Gemini CLI',       requiresTTY: true },
    'gemini':      { cmd: 'npx', args: ['-y', '@google/gemini-cli'],        label: 'Gemini CLI',       requiresTTY: true },
    'mock':        { builtin: 'mock', label: 'Mock Harness (simulated telemetry)' },
    'zo':          { builtin: 'mock', label: 'Mock fallback' },
  };

  const harnessSpec = HARNESS_MAP[harness] || HARNESS_MAP['mock'];

  const env = {
    ...process.env,
    ZAF_TICKET_ID:    formattedId,
    ZAF_REPO_NAME:    repoName,
    ZAF_AGENT_ROLE:   role,
    ZAF_HARNESS_ID:   harness,
    ZAF_MODEL:        model     || '',
    ZAF_REASONING:    reasoning || '',
    ZAF_HEARTBEAT:    heartbeat || '40',
    ZAF_SKILL_FILE:   transientSkillPath,
    PAGER:            'cat',
  };

  if (harnessSpec.builtin === 'mock') {
    console.log(`Mock harness engaged for ${formattedId} (role=${role}).`);
    console.log(`[DECISION] Reading ticket ${formattedId} and last handoff entry.`);
    console.log(`[DECISION] Last handoff: ${lastHandoff.slice(0, 140)}`);
    const heartbeatMs = Math.max(1000, Math.min(15000, parseInt(heartbeat || '5', 10) * 100));
    const steps = [
      { kind: 'TOOL CALL',   text: `read_file WIP/tickets/ACTIVE/${formattedId}.md` },
      { kind: 'TOOL CALL',   text: `list_dir src/` },
      { kind: 'API REQUEST', text: `POST /v1/messages model=${model || 'claude-3-7-sonnet'} reasoning=${reasoning || 'medium'}` },
      { kind: 'DECISION',    text: `Plan drafted: 3 substeps identified for ticket ${formattedId}.` },
      { kind: 'TOOL CALL',   text: `apply_patch <scoped to ticket directory>` },
      { kind: 'TOOL CALL',   text: `run_tests --filter ${role}` },
      { kind: 'API REQUEST', text: `POST /v1/messages model=${model || 'claude-3-7-sonnet'} continuation=true` },
      { kind: 'DECISION',    text: `Acceptance criteria satisfied. Writing Handoff Log entry.` },
    ];
    let i = 0;
    const tick = () => {
      if (i >= steps.length) {
        console.log(`[DECISION] Mock harness finished simulated turn budget.`);
        console.log(`(Mock did NOT modify the ticket. To wire a real CLI, set its harness to claude-code / codex / gemini-cli and run from a terminal with a TTY.)`);
        if (fs.existsSync(transientSkillPath)) {
          try { fs.unlinkSync(transientSkillPath); console.log('Cleaned up .zaf-skill.md'); } catch {}
        }
        process.exit(0);
      }
      const s = steps[i++];
      console.log(`[${s.kind}] ${s.text}`);
      setTimeout(tick, heartbeatMs);
    };
    setTimeout(tick, 250);
    return;
  }

  const hasTTY = !!process.stdout.isTTY && !!process.stdin.isTTY;
  if (harnessSpec.requiresTTY && !hasTTY) {
    console.log(`The "${harnessSpec.label}" harness requires a real interactive terminal (TTY).`);
    console.log(`The dashboard subshell pipes stdio, so interactive CLIs exit immediately in that mode.`);
    console.log(``);
    console.log(`To launch this CLI manually, copy/paste:`);
    console.log(``);
    console.log(`    cd "${REPO_ROOT}"`);
    console.log(`    ${harnessSpec.cmd} ${harnessSpec.args.join(' ')}`);
    console.log(``);
    console.log(`Or select the "mock" harness on this ticket to simulate a run end-to-end inside the dashboard.`);
    if (fs.existsSync(transientSkillPath)) {
      try { fs.unlinkSync(transientSkillPath); } catch {}
    }
    process.exit(0);
  }

  const cmd  = harnessSpec.cmd;
  const args = harnessSpec.args;
  console.log(`Spawning subprocess harness: "${cmd} ${args.join(' ')}"...`);

  const child = spawn(cmd, args, {
    stdio: hasTTY ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    cwd: REPO_ROOT,
    env,
    shell: process.platform === 'win32',
  });

  let turns = 0;
  const maxTurns = 20;

  child.stdout.on('data', (dataChunk) => {
    const chunkStr = dataChunk.toString();
    process.stdout.write(dataChunk);
    if (chunkStr.includes('Running command') || chunkStr.includes('executing')) {
      turns++;
      if (turns >= maxTurns) {
        console.log(`\n[ZAF Control] Turn-budget limit reached (${maxTurns} steps). Forcing safe termination.`);
        child.kill('SIGINT');
      }
    }
  });

  child.stderr.on('data', (dataChunk) => {
    process.stderr.write(dataChunk);
  });

  const syncInterval = setInterval(() => {
    try {
      if (fs.existsSync(filePath)) {
        const checkRaw = fs.readFileSync(filePath, 'utf8');
        const { data: checkData } = parseFrontMatter(checkRaw);
        if (checkData.status === 'DONE') {
          console.log(`\n[ZAF Control] Ticket ${formattedId} marked as DONE on disk. Terminating subshell gracefully.`);
          clearInterval(syncInterval);
          child.kill('SIGINT');
        }
      }
    } catch (e) {
      // ignore
    }
  }, 2000);

  child.on('close', (code) => {
    clearInterval(syncInterval);
    console.log(`\n======================================================`);
    console.log(`Subprocess harness terminated with exit code: ${code}`);
    if (fs.existsSync(transientSkillPath)) {
      try {
        fs.unlinkSync(transientSkillPath);
        console.log(`Cleaned up transient file: .zaf-skill.md`);
      } catch (err) {
        console.error('Failed cleaning up .zaf-skill.md');
      }
    }
    console.log(`======================================================\n`);
  });
}

// Main dispatcher

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'banner') {
  printBanner();
  process.exit(0);
}

if (command === 'ticket') {
  const subCommand = argv[1];
  if (subCommand === 'status') {
    handleTicketStatus(argv[2]);
  } else if (subCommand === 'create') {
    handleTicketCreate(argv[2]);
  } else {
    console.error(`Error: Unknown ticket command: "${subCommand}". Supported: status, create.`);
    process.exit(1);
  }
} else if (command === 'run') {
  const role = argv[1];
  const tktIdx = argv.indexOf('--ticket');
  if (tktIdx === -1 || !argv[tktIdx + 1]) {
    console.error('Error: Missing required --ticket <TKT-ID> parameter.');
    process.exit(1);
  }
  const ticketId = argv[tktIdx + 1];
  const harnessIdx = argv.indexOf('--harness');
  const harness = harnessIdx !== -1 ? argv[harnessIdx + 1] : 'claude';
  const modelIdx = argv.indexOf('--model');
  const model = modelIdx !== -1 ? argv[modelIdx + 1] : '';
  const reasoningIdx = argv.indexOf('--reasoning');
  const reasoning = reasoningIdx !== -1 ? argv[reasoningIdx + 1] : '';
  const heartbeatIdx = argv.indexOf('--heartbeat');
  const heartbeat = heartbeatIdx !== -1 ? argv[heartbeatIdx + 1] : '';
  handleRun(role, ticketId, harness, model, reasoning, heartbeat);
} else {
  console.error(`Error: Unknown command: "${command}". Run "zaf" for help.`);
  process.exit(1);
}
