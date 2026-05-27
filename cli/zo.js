#!/usr/bin/env node

/**
 * ZAF CLI Tool (zo.js)
 * The control plane command-line wrapper for the Zero to One Agentic Framework (ZO.AF)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Repo Root Auto-Discovery ───────────────────────────────────────────────────

function findRepoRoot() {
  let current = process.cwd();
  while (true) {
    const ticketsIndex = path.join(current, 'WIP', 'tickets', 'TICKETS.md');
    if (fs.existsSync(ticketsIndex)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Fallback: use process.cwd() and assume it has WIP
      return process.cwd();
    }
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const ACTIVE_DIR = path.join(REPO_ROOT, 'WIP', 'tickets', 'ACTIVE');
const ARCHIVED_DIR = path.join(REPO_ROOT, 'WIP', 'tickets', 'ARCHIVED');
const TICKETS_INDEX_PATH = path.join(REPO_ROOT, 'WIP', 'tickets', 'TICKETS.md');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      // Parse arrays e.g. [a, b]
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

function stringifyFrontMatter(data) {
  let str = '---\n';
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      str += `${k}: [${v.map(x => `"${x}"`).join(', ')}]\n`;
    } else {
      str += `${k}: "${v}"\n`;
    }
  }
  str += '---\n';
  return str;
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
        break; // entered another section
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
    
    return `### 👤 Role Profile: ${headerName}\n\n${profileLines.join('\n').trim()}`;
  } catch (err) {
    return `*   **Role**: ${role}\n*   **Parser Warning**: Failed to parse agent-taxonomy.md dynamically (${err.message})`;
  }
}

// ─── Command: Ticket Status ────────────────────────────────────────────────────

function handleTicketStatus(ticketId) {
  if (!ticketId) {
    console.error('❌ Error: Please specify a ticket ID (e.g. TKT-ZAF-0005)');
    process.exit(1);
  }

  // Ensure standard formatting (force prefix if missing numeric parts)
  let formattedId = ticketId.toUpperCase();
  if (!formattedId.startsWith('TKT-')) {
    formattedId = `TKT-ZAF-${formattedId.padStart(4, '0')}`;
  }

  let filePath = path.join(ACTIVE_DIR, `${formattedId}.md`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ARCHIVED_DIR, `${formattedId}.md`);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: Ticket ${formattedId} not found in ACTIVE or ARCHIVED.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontMatter(raw);
  const lastHandoff = getLastHandoffLog(body);

  console.log(`\n======================================================`);
  console.log(`🎫 TICKET: ${data.id || formattedId}`);
  console.log(`======================================================`);
  console.log(`📌 Title:      ${data.title || 'N/A'}`);
  console.log(`🟢 Status:     \x1b[36m${data.status || 'OPEN'}\x1b[0m`);
  console.log(`🏗 Workstream: ${data.workstream || 'none'}`);
  console.log(`📅 Phase:      ${data.phase || 'N/A'}`);
  console.log(`⚠️ Priority:   ${data.priority || 'N/A'}`);
  console.log(`📁 Repo:       ${data.repo || 'N/A'}`);
  console.log(`👥 Roles:      ${Array.isArray(data.roles) ? data.roles.join(', ') : 'N/A'}`);
  console.log(`🔗 Blocks:     ${Array.isArray(data.blocks) ? data.blocks.join(', ') : 'none'}`);
  console.log(`⛓ Blocked By: ${Array.isArray(data.blocked_by) ? data.blocked_by.join(', ') : 'none'}`);
  console.log(`------------------------------------------------------`);
  console.log(`📝 Last Handoff Log Entry:`);
  console.log(`   ${lastHandoff}`);
  console.log(`======================================================\n`);
}

// ─── Command: Ticket Create ────────────────────────────────────────────────────

function handleTicketCreate(title) {
  if (!title) {
    console.error('❌ Error: Please specify a ticket title enclosed in quotes.');
    process.exit(1);
  }

  // Auto-discover next ID by reading ACTIVE/ARCHIVED directory files
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
    console.warn('⚠️ Warning: Failed scanning directories, defaulting sequencing.');
  }

  const nextNum = maxNum + 1;
  const nextId = `TKT-ZAF-${String(nextNum).padStart(4, '0')}`;
  const currentDate = getFormattedDate();

  // Scaffold ticket content
  const ticketContent = `---
id: ${nextId}
title: ${title}
status: OPEN
programme: PROG-ZAF-001
workstream: none
phase: P3
priority: P2
project: ZO Agentic Framework
repo: zo-agentic-framework
team: engineering
roles: [antigravity-ide]
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

- ${currentDate} | operator | OPEN — Ticket created.
`;

  const newFilePath = path.join(ACTIVE_DIR, `${nextId}.md`);
  if (!fs.existsSync(ACTIVE_DIR)) {
    fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  }

  fs.writeFileSync(newFilePath, ticketContent, 'utf8');
  console.log(`🟢 Successfully created ticket file: WIP/tickets/ACTIVE/${nextId}.md`);

  // Update central TICKETS.md
  if (fs.existsSync(TICKETS_INDEX_PATH)) {
    let indexContent = fs.readFileSync(TICKETS_INDEX_PATH, 'utf8');
    const lines = indexContent.split(/\r?\n/);
    
    // Find where the table under Phase 3 is
    let p3HeaderIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('### Phase 3 — CLI Integration')) {
        p3HeaderIdx = i;
        break;
      }
    }

    if (p3HeaderIdx !== -1) {
      // Find the last row in this section
      let insertIdx = -1;
      for (let j = p3HeaderIdx + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim().startsWith('---') || (line.trim().startsWith('##') && !line.trim().startsWith('###'))) {
          // End of section
          insertIdx = j;
          break;
        }
      }

      // If we didn't find the end, default to the bottom of the section
      if (insertIdx === -1) {
        insertIdx = lines.length;
      }

      // Find the last table row inside this section to insert after
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
        // Table not populated yet, append after table header
        let headerBoundary = p3HeaderIdx + 3; // ### + blank + header + divider
        lines.splice(headerBoundary, 0, newTableRow);
      }

      // Increment next ticket numbers at the top and bottom of TICKETS.md
      let nextIdNum = nextNum + 1;
      const nextIdStr = `TKT-ZAF-${String(nextIdNum).padStart(4, '0')}`;
      
      indexContent = lines.join('\n');
      indexContent = indexContent.replace(/Next ticket number:\s*\*\*TKT-ZAF-\d+\*\*/g, `Next ticket number: **${nextIdStr}**`);
      indexContent = indexContent.replace(/Next ticket number:\s*TKT-ZAF-\d+/g, `Next ticket number: ${nextIdStr}`);

      fs.writeFileSync(TICKETS_INDEX_PATH, indexContent, 'utf8');
      console.log(`🟢 Successfully synced and updated ticket index in: WIP/tickets/TICKETS.md`);
    } else {
      console.warn('⚠️ Warning: Phase 3 header not found in TICKETS.md, skipped indexing.');
    }
  } else {
    console.warn('⚠️ Warning: TICKETS.md index file not found, skipped indexing.');
  }
}

// ─── Command: Run ──────────────────────────────────────────────────────────────

function handleRun(role, ticketId, harnessOption, model, reasoning, heartbeat) {
  if (!role || !ticketId) {
    console.error('❌ Error: Usage: zo run <role> --ticket <TKT-ID> [--harness <name>]');
    process.exit(1);
  }

  let formattedId = ticketId.toUpperCase();
  if (!formattedId.startsWith('TKT-')) {
    formattedId = `TKT-ZAF-${formattedId.padStart(4, '0')}`;
  }

  const filePath = path.join(ACTIVE_DIR, `${formattedId}.md`);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: Active ticket ${formattedId} not found in ${ACTIVE_DIR}.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontMatter(raw);
  const lastHandoff = getLastHandoffLog(body);

  const repoName = data.repo || path.basename(REPO_ROOT);
  const harness = harnessOption || 'claude';

  console.log(`\n======================================================`);
  console.log(`🚀 ZAF SOVEREIGN SUBPROCESS HARNESS SPINNER`);
  console.log(`======================================================`);
  console.log(`🎫 Active Ticket: ${formattedId}`);
  console.log(`🎭 Assigned Role: ${role}`);
  console.log(`🛡️ Harness Tech:  ${harness}`);
  console.log(`📂 Repository:    ${repoName}`);
  if (model) console.log(`🪙 Target Model:  ${model}`);
  if (reasoning) console.log(`🧠 Reasoning Lvl: ${reasoning}`);
  if (heartbeat) console.log(`💓 Heartbeat:     ${heartbeat}s`);
  console.log(`======================================================\n`);

  // 1. Compile Transient Skill Harness (.zaf-skill.md)
  const transientSkillPath = path.join(REPO_ROOT, '.zaf-skill.md');
  const roleProfile = getRoleProfile(role);
  
  const skillBlueprint = `# ZAF HARNESS SYSTEM SKILL

> **Warning to Assistant**: You are executing under the ZO Agentic Framework (ZAF) control plane. You must strictly follow these operational constraints.

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
You are authorized to read and write files ONLY within the following boundaries:
*   **Repository Root (Writable)**: \`${path.resolve(REPO_ROOT)}\`
*   **Active Tickets (Append-Only logs/Status)**: \`${ACTIVE_DIR}\`
*   **System configurations & vault credentials**: Completely Read-only / Unauthorized.

## 4. Operational Constraints
1.  **Ticket State Modification**:
    *   Do not delete ticket files.
    *   To complete this task, you must rewrite the metadata front-matter status at the top of \`WIP/tickets/ACTIVE/${formattedId}.md\` from \`status: IN_PROGRESS\` (or other status) to \`status: DONE\`.
2.  **Standard Handoff Logging**:
    *   Before you finish your execution, you MUST append a new chronological log entry to the \`## Handoff Log\` at the bottom of the active ticket.
    *   Format: \`- YYYY-MM-DD | ${role} | DONE — [Your work description and remaining steps]\`.
3.  **Strict File Scoping**:
    *   You are only permitted to write or modify files under the target repository folder.
    *   System files, vault secrets, and root settings are completely read-only.
4.  **No Hallucinations**:
    *   If you encounter a missing credential, an ambiguous requirement, or a policy question, do not guess.
    *   Stop immediately, change the ticket status to \`status: BLOCKED\`, log the specific blocker details in the Handoff Log, and alert the operator.
`;

  fs.writeFileSync(transientSkillPath, skillBlueprint, 'utf8');
  console.log(`⚙️ Injected transient skill overlay: .zaf-skill.md`);

  // 2. Select CLI harness target command
  let cmd = '';
  let args = [];

  if (harness === 'claude') {
    cmd = 'npx';
    args = ['-y', '@anthropic-ai/claude-code'];
  } else if (harness === 'gemini' || harness === 'mock') {
    // Scaffold custom interactive prompt harness or fallback shell
    cmd = process.platform === 'win32' ? 'powershell' : 'bash';
    console.log(`⚠️ Using native CLI subprocess harness (${cmd}).`);
  } else {
    // Fallback to standard platform shell
    cmd = process.platform === 'win32' ? 'powershell' : 'bash';
  }

  // 3. Set environment variables for isolation
  const env = {
    ...process.env,
    ZAF_TICKET_ID: formattedId,
    ZAF_REPO_NAME: repoName,
    ZAF_AGENT_ROLE: role,
    PAGER: 'cat' // standard pager override
  };

  console.log(`🟢 Spawning subprocess harness: "${cmd} ${args.join(' ')}"...`);

  const child = spawn(cmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: REPO_ROOT,
    env
  });

  let turns = 0;
  const maxTurns = 20;

  // Pipe stdout and scan for command turn telemetry
  child.stdout.on('data', (dataChunk) => {
    const chunkStr = dataChunk.toString();
    process.stdout.write(dataChunk);

    // Turn Budget Tracker: Scan for triggers of command entries
    // e.g. Claude Code CLI executes a command, usually denoted by particular formatting or prompt tags.
    // For general terminals, we increment on prompt inputs or typical triggers.
    if (chunkStr.includes('✔') || chunkStr.includes('Running command') || chunkStr.includes('executing')) {
      turns++;
      if (turns >= maxTurns) {
        console.log(`\n\x1b[31m[ZAF Control] Turn-Budget limit reached (${maxTurns} steps)! Forcing safe termination to prevent agent drift.\x1b[0m`);
        child.kill('SIGINT');
      }
    }
  });

  child.stderr.on('data', (dataChunk) => {
    process.stderr.write(dataChunk);
  });

  // Simple Sync Watch Loop (checks active ticket file status every 2 seconds)
  const syncInterval = setInterval(() => {
    try {
      if (fs.existsSync(filePath)) {
        const checkRaw = fs.readFileSync(filePath, 'utf8');
        const { data: checkData } = parseFrontMatter(checkRaw);
        if (checkData.status === 'DONE') {
          console.log(`\n\x1b[32m[ZAF Control] Ticket ${formattedId} marked as DONE on disk! Terminating subshell gracefully.\x1b[0m`);
          clearInterval(syncInterval);
          child.kill('SIGINT');
        }
      }
    } catch (e) {
      // ignore check failures
    }
  }, 2000);

  // Cleanups on close
  child.on('close', (code) => {
    clearInterval(syncInterval);
    console.log(`\n======================================================`);
    console.log(`🛑 Subprocess harness terminated with exit code: ${code}`);
    
    // Clean up transient file
    if (fs.existsSync(transientSkillPath)) {
      try {
        fs.unlinkSync(transientSkillPath);
        console.log(`🧹 Cleaned up transient file: .zaf-skill.md`);
      } catch (err) {
        console.error('⚠️ Failed cleaning up .zaf-skill.md');
      }
    }
    console.log(`======================================================\n`);
  });
}

// ─── Main CLI Dispatcher ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.log(`
Zero to One Agentic Framework (ZO.AF) CLI

Usage:
  zo ticket status <TKT-ID>            Parse and show status of a ticket
  zo ticket create "<title>"            Scaffold and index a new ticket
  zo run <role> --ticket <TKT-ID> [--harness <claude|mock>]
                                        Run sovereign harness subprocess runner

Examples:
  zo ticket status TKT-ZAF-0005
  zo ticket create "Scaffold CLI Interface"
  zo run engineering --ticket TKT-ZAF-0005 --harness mock
  `);
  process.exit(0);
}

if (command === 'ticket') {
  const subCommand = args[1];
  if (subCommand === 'status') {
    handleTicketStatus(args[2]);
  } else if (subCommand === 'create') {
    handleTicketCreate(args[2]);
  } else {
    console.error(`❌ Error: Unknown ticket command: "${subCommand}". Supported: status, create.`);
    process.exit(1);
  }
} else if (command === 'run') {
  const role = args[1];
  const tktIdx = args.indexOf('--ticket');
  if (tktIdx === -1 || !args[tktIdx + 1]) {
    console.error('❌ Error: Missing required --ticket <TKT-ID> parameter.');
    process.exit(1);
  }
  const ticketId = args[tktIdx + 1];

  const harnessIdx = args.indexOf('--harness');
  const harness = harnessIdx !== -1 ? args[harnessIdx + 1] : 'claude';

  const modelIdx = args.indexOf('--model');
  const model = modelIdx !== -1 ? args[modelIdx + 1] : '';

  const reasoningIdx = args.indexOf('--reasoning');
  const reasoning = reasoningIdx !== -1 ? args[reasoningIdx + 1] : '';

  const heartbeatIdx = args.indexOf('--heartbeat');
  const heartbeat = heartbeatIdx !== -1 ? args[heartbeatIdx + 1] : '';

  handleRun(role, ticketId, harness, model, reasoning, heartbeat);
} else {
  console.error(`❌ Error: Unknown command: "${command}". Run "zo" for help.`);
  process.exit(1);
}
