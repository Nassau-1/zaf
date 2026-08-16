#!/usr/bin/env node
/**
 * parse.js — ZO WIP Dashboard v2 Multi-Repo Parser
 * Scans REPOS_ROOT for repos with a WIP/tickets/TICKETS.md structure.
 * Outputs data.json consumed by the dashboard.
 *
 * Usage: node parse.js [--repos-root "C:\path\to\01_Repos"]
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// ─── Config ───────────────────────────────────────────────────────────────────

function getReposRoot() {
  const argIdx = process.argv.indexOf('--repos-root');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return path.resolve(process.argv[argIdx + 1]);
  }
  // Default: two levels up from dashboard/ = 01_Repos/
  return path.resolve(__dirname, '../../');
}

const REPOS_ROOT = getReposRoot();
const OUTPUT_FILE = path.join(__dirname, 'data.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function listMdFiles(dir) {
  try {
    // Performance optimization: Avoid separate fs.statSync calls by using withFileTypes
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('.'))
      .map(d => path.join(dir, d.name));
  } catch { return []; }
}

function ensureArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
  return [String(val)];
}

// ─── Repo Discovery ───────────────────────────────────────────────────────────

function discoverRepos() {
  const repos = [];
  let entries;
  try { entries = fs.readdirSync(REPOS_ROOT, { withFileTypes: true }); } catch { return repos; }

  for (const dirent of entries) {
    const name = dirent.name;
    // Performance optimization: Avoid separate fs.statSync calls by using withFileTypes
    if (!dirent.isDirectory()) continue;
    if (name.startsWith('.')) continue;
    const repoPath = path.join(REPOS_ROOT, name);

    const ticketsIndexPath = path.join(repoPath, 'WIP', 'tickets', 'TICKETS.md');
    if (fs.existsSync(ticketsIndexPath)) {
      repos.push({
        id: name,
        label: name,
        path: repoPath,
        wipPath: path.join(repoPath, 'WIP'),
        ticketsIndexPath,
      });
    }
  }

  return repos;
}

// ─── Ticket Parser ────────────────────────────────────────────────────────────

function parseTicket(filePath, repoId) {
  const raw = readFile(filePath);
  if (!raw) return null;

  let parsed;
  try { parsed = matter(raw); } catch {
    parsed = { data: {}, content: raw };
  }

  const d = parsed.data || {};
  const filename = path.basename(filePath, '.md');

  return {
    id: String(d.id || filename),
    title: String(d.title || filename),
    status: String(d.status || 'OPEN').toUpperCase(),
    programme: d.programme ? String(d.programme) : null,
    workstream: d.workstream ? String(d.workstream) : null,
    phase: d.phase ? String(d.phase) : null,
    priority: d.priority ? String(d.priority) : null,
    project: d.project ? String(d.project) : null,
    repo: d.repo ? String(d.repo) : null,
    team: d.team ? String(d.team) : null,
    roles: ensureArray(d.roles),
    archetype: d.archetype ? String(d.archetype) : null,
    blocks: ensureArray(d.blocks),
    blocked_by: ensureArray(d.blocked_by),
    created: d.created ? String(d.created) : null,
    updated: d.updated ? String(d.updated) : null,
    usage_checkpoint: d.usage_checkpoint ? String(d.usage_checkpoint) : null,
    body: parsed.content || '',
    filePath,
    repoId,  // ← new: which repo this ticket belongs to
  };
}

// ─── TICKETS.md Phase Group Parser ───────────────────────────────────────────

function parseTicketsIndex(filePath) {
  const raw = readFile(filePath);
  if (!raw) return [];

  const groups = [];
  let currentGroup = null;

  for (const line of raw.split(/\r?\n/)) {
    const hMatch = line.match(/^###\s+(.+)/);
    if (hMatch) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { title: hMatch[1].trim(), tickets: [], notes: [] };
      continue;
    }
    if (currentGroup && line.startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && cells[0].match(/^TKT-/)) {
        currentGroup.tickets.push(cells[0]);
      }
    }
    if (currentGroup && line.startsWith('*Note')) {
      currentGroup.notes.push(line.replace(/^\*/, '').replace(/\*$/, '').trim());
    }
  }
  if (currentGroup) groups.push(currentGroup);
  return groups;
}

// ─── Programme Parser ─────────────────────────────────────────────────────────

function parseProgramme(filePath, repoId) {
  const raw = readFile(filePath);
  if (!raw) return null;
  const filename = path.basename(filePath, '.md');

  const phases = [];
  const phaseRegex = /###\s+(Phase\s+[\w\d\-–]+[^\n]*)\n\n([\s\S]*?)(?=\n---|\n###|\n##|\Z)/g;
  let m;
  while ((m = phaseRegex.exec(raw)) !== null) {
    const title = m[1].trim();
    let gateStatus = 'PENDING';
    if (title.includes('✓') || title.toLowerCase().includes('complete')) gateStatus = 'COMPLETE';
    else if (title.includes('←') || title.toLowerCase().includes('current') || title.toLowerCase().includes('active')) gateStatus = 'ACTIVE';
    const objMatch = m[2].match(/\*\*Objective\*\*:\s*([^\n]+)/);
    phases.push({ title, gateStatus, objective: objMatch ? objMatch[1].trim() : '' });
  }

  const workstreams = [];
  const wsRegex = /###\s+(WS-[A-Z\-]+)[^\n]*\n\n([\s\S]*?)(?=\n###|\n---|\Z)/g;
  while ((m = wsRegex.exec(raw)) !== null) {
    const goalMatch = m[2].match(/\*\*Goal\*\*:\s*([^\n]+)/);
    const stateMatch = m[2].match(/\*\*Current state[^*]*\*\*:\s*([^\n]+)/);
    workstreams.push({
      id: m[1].trim(),
      goal: goalMatch ? goalMatch[1].trim() : '',
      currentState: stateMatch ? stateMatch[1].trim() : '',
    });
  }

  const oqs = [];
  const oqBlock = raw.match(/## Open Questions[\s\S]*?\n\| ID[\s\S]*?(?=\n---|\n##|\Z)/);
  if (oqBlock) {
    for (const row of oqBlock[0].split('\n').filter(l => l.startsWith('|')).slice(2)) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 3 && cells[0].match(/^OQ-/)) {
        oqs.push({
          id: cells[0],
          question: cells[1],
          blocks: cells[2],
          status: cells[3]?.startsWith('**ANSWERED') ? 'ANSWERED' : 'OPEN',
          answer: cells[3] || '',
        });
      }
    }
  }

  return {
    id: filename,
    title: raw.match(/^#\s+(.+)/m)?.[1]?.trim() || filename,
    phases,
    workstreams,
    openQuestions: oqs,
    body: raw,
    filePath,
    repoId,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function buildStats(tickets) {
  const byStatus = {}, byWorkstream = {}, byPhase = {}, byTeam = {}, byPriority = {}, byRepo = {};
  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (t.workstream) byWorkstream[t.workstream] = (byWorkstream[t.workstream] || 0) + 1;
    if (t.phase) byPhase[t.phase] = (byPhase[t.phase] || 0) + 1;
    if (t.team) byTeam[t.team] = (byTeam[t.team] || 0) + 1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    if (t.repoId) byRepo[t.repoId] = (byRepo[t.repoId] || 0) + 1;
  }
  return { byStatus, byWorkstream, byPhase, byTeam, byPriority, byRepo };
}

// ─── Dependency Graph ─────────────────────────────────────────────────────────

function buildGraph(activeTickets) {
  const nodes = activeTickets.map(t => ({
    id: t.id, title: t.title, status: t.status,
    workstream: t.workstream, priority: t.priority, repoId: t.repoId,
  }));
  const edges = [];
  for (const t of activeTickets) {
    for (const blockee of (t.blocks || [])) {
      edges.push({ from: t.id, to: blockee, type: 'blocks' });
    }
  }
  return { nodes, edges };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('🔍 ZO WIP Dashboard — multi-repo parse...');
  console.log(`   Repos root: ${REPOS_ROOT}`);

  const repos = discoverRepos();
  console.log(`   Discovered repos: ${repos.map(r => r.id).join(', ') || '(none)'}`);

  const allActive = [], allArchived = [], allPhaseGroups = [], allProgrammes = [];

  for (const repo of repos) {
    // Active tickets
    const activeDir = path.join(repo.wipPath, 'tickets', 'ACTIVE');
    const activeTickets = listMdFiles(activeDir)
      .map(f => parseTicket(f, repo.id))
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    allActive.push(...activeTickets);

    // Archived tickets
    const archivedDir = path.join(repo.wipPath, 'tickets', 'ARCHIVED');
    const archivedTickets = listMdFiles(archivedDir)
      .filter(f => !f.includes('presentation'))
      .map(f => parseTicket(f, repo.id))
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    allArchived.push(...archivedTickets);

    // Phase groups from TICKETS.md
    const groups = parseTicketsIndex(repo.ticketsIndexPath);
    allPhaseGroups.push({ repoId: repo.id, groups });

    // Programmes
    const progDir = path.join(repo.wipPath, 'programmes');
    const progFiles = listMdFiles(progDir)
      .filter(f => !f.includes('STATUS') && !f.includes('.gitkeep') && !f.includes('ZO-Migration') && !f.includes('README'));
    for (const pf of progFiles) {
      const prog = parseProgramme(pf, repo.id);
      if (prog) allProgrammes.push(prog);
    }

    console.log(`   [${repo.id}] active=${activeTickets.length} archived=${archivedTickets.length} programmes=${progFiles.length}`);
  }

  const stats = buildStats(allActive);
  const graph = buildGraph(allActive);

  const output = {
    generated: new Date().toISOString(),
    reposRoot: REPOS_ROOT,
    repos: repos.map(r => ({ id: r.id, label: r.label })),
    tickets: { active: allActive, archived: allArchived },
    phaseGroups: allPhaseGroups,
    programmes: allProgrammes,
    stats,
    graph,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  const kb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`\n✅ data.json — ${kb} KB | active=${allActive.length} archived=${allArchived.length} programmes=${allProgrammes.length}`);
  console.log(`   Status: ${JSON.stringify(stats.byStatus)}`);
}

main();
