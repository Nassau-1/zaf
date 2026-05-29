/**
 * app.js — ZAF Control Plane (Paperclip-grade)
 *
 *   - Multi-repo unified overview (kanban gauges + analyst load)
 *   - Drag-and-drop SVG Org/Team Builder (supervisor edges, role personas)
 *   - Multi-console terminal panel (per-process tabs, live SSE streaming)
 *   - Immutable audit log view
 *   - Dynamic CLI provider discovery (--help parsing)
 *   - Real heartbeat units and telemetry-backed quotas
 */

// =========================================================================
// CONFIG
// =========================================================================

const DATA_URL  = '/api/data';
const WATCH_URL = '/api/watch';

const STATUS_ORDER = ['IN_PROGRESS','BLOCKED','IN_REVIEW','WAITING_INPUT','OPEN','DONE'];
const STATUS_LABELS = {
  OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING_INPUT: 'Waiting',
  BLOCKED: 'Blocked', IN_REVIEW: 'Review', DONE: 'Done',
  DONE_WITH_ERRORS: 'Done w/ Err',
};
const STATUS_COLORS = {
  OPEN: '#3b82f6', IN_PROGRESS: '#6366f1', WAITING_INPUT: '#f59e0b',
  BLOCKED: '#ef4444', IN_REVIEW: '#a855f7', DONE: '#22c55e',
  DONE_WITH_ERRORS: '#f97316',
};
const PRIORITY_COLORS = { P0:'#ef4444', P1:'#f97316', P2:'#eab308', P3:'#64748b' };
const WS_COLORS = {
  'WS-UX':'#f472b6','WS-SHELL':'#818cf8','WS-DATA':'#34d399','WS-SERVICES':'#60a5fa',
  'WS-CRM':'#fb923c','WS-INTELLIGENCE':'#a78bfa','WS-REPOS':'#94a3b8','WS-ASSISTANT':'#2dd4bf',
  'WS-INFRA':'#fbbf24','WS-DASHBOARD':'#38bdf8','WS-DOCS':'#f0abfc','WS-CLI':'#86efac','none':'#64748b',
};
const STRUCTURAL_PERSONAS = {
  thinker: {
    icon: 'PLAN', label: 'Thinker (Planner)',
    persona: 'You are a planning specialist. Decompose objectives, write step-by-step plans, identify risks, never write code unless a subordinate worker is unavailable. Optimise for clarity, sequencing, and dependency mapping.',
    bounds: 'Read-only on workspace files. May propose, never directly write code. Must annotate decisions with rationale.',
  },
  reviewer: {
    icon: 'AUDIT', label: 'Reviewer (Auditor)',
    persona: 'You are a code & quality auditor. Read changes, identify defects, security issues, performance regressions, and policy violations. Refuse to write production code; instead, recommend.',
    bounds: 'Read-only on workspace. May write into review logs and audit artefacts only.',
  },
  worker: {
    icon: 'BUILD', label: 'Worker (Compiler)',
    persona: 'You are the standard executor. Take a scoped ticket, implement the change, run tests, commit work. Be terse, follow the plan, do not refactor beyond scope.',
    bounds: 'Read/write on workspace files within the assigned ticket scope. May run build/test commands. May not change CI or merge.',
  },
};

// =========================================================================
// STATE
// =========================================================================

const STATE = {
  data: null,
  config: null,
  currentView: 'overview',
  selectedRepo: '',
  filters: { search:'', workstream:'', phase:'', team:'', priority:'', status:'' },
  selectedTicketId: null,
  ticketMap: {},
  graphPan: { x:0, y:0, zoom:1 },
  archiveSort: { col:'id', dir:'asc' },
  // Phase 5 — Paperclip additions
  processes: new Map(),      // processId -> { meta, lines:[] }
  terminals: new Map(),      // processId -> Terminal instance (xterm.js)
  terminalLastTs: new Map(), // processId -> highest ts written to terminal (dedup)
  prefireCountdowns: new Map(), // processId -> intervalId
  activeProcessTab: null,
  consoleOpen: false,
  audit: [],
  cliDiscoveryCache: {},
  selectedAgentKey: null,
  selectedOrgTeamId: null,
  selectedOrgAgentKey: null,
  controlTab: 'ticket',
  fleetProcessIds: new Set(),     // processIds dispatched via fleet
  fleetSelectedTickets: new Set(),// ticketIds selected in fleet multi-picker
  // CLI Hub (TKT-ZAF-0019)
  cliHubProcesses: new Map(),  // processId -> { harnessId, kind: 'install'|'connect' }
  cliHubStatus: {},            // harnessId -> { installed, version }
  cliHubConnected: {},         // harnessId -> connected-at timestamp string
  // Agent view (TKT-ZAF-0021)
  agentViewActive: new Map(),  // processId -> bool
  agentTextBuffers: new Map(), // processId -> accumulated stripped-ANSI text string
  agentLineCursors: new Map(), // processId -> int (line count already rendered to agent view)
};

// =========================================================================
// INIT
// =========================================================================

async function init() {
  bindNav();
  bindDetailClose();
  bindRefresh();
  bindConsolePanel();
  bindTopbarConsoleToggle();
  initConsoleResize();
  bindNewRepoButton();
  await loadData();
  bindRepoSelector();
  await loadAudit();
  await loadProcesses();
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
  connectSSE();
  registerTauriListeners();
}

document.addEventListener('DOMContentLoaded', init);

// =========================================================================
// DATA
// =========================================================================

async function loadData() {
  try {
    const r = await fetch(DATA_URL + '?t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    STATE.data = await r.json();

    try {
      const cr = await fetch('/api/config?t=' + Date.now());
      if (cr.ok) STATE.config = await cr.json();
    } catch {}

    STATE.ticketMap = {};
    for (const t of STATE.data.tickets.active)   STATE.ticketMap[t.id] = t;
    for (const t of STATE.data.tickets.archived) STATE.ticketMap[t.id] = t;

    populateRepoSelector();
    updateSidebarStats();
    updateBadges();
    updateTimestamp();
    hideLoading();
  } catch (err) {
    showError(err);
  }
}

async function loadAudit() {
  try {
    const r = await fetch('/api/audit?limit=500');
    if (!r.ok) return;
    const data = await r.json();
    STATE.audit = data.entries || [];
    document.getElementById('runtime-audit').textContent = STATE.audit.length;
    document.getElementById('badge-audit').textContent   = STATE.audit.length;
  } catch {}
}

async function loadProcesses() {
  try {
    const r = await fetch('/api/processes');
    if (!r.ok) return;
    const data = await r.json();
    for (const meta of data.processes) {
      if (!STATE.processes.has(meta.processId)) {
        STATE.processes.set(meta.processId, { meta, lines: [] });
      }
    }
    renderConsoleTabs();
    updateShellCounter();
  } catch {}
}

function updateSidebarStats() {
  const tickets = getActiveTickets();
  const s = {};
  for (const t of tickets) s[t.status] = (s[t.status] || 0) + 1;
  document.getElementById('stat-blocked').textContent    = s.BLOCKED       || 0;
  document.getElementById('stat-inprogress').textContent = s.IN_PROGRESS   || 0;
  document.getElementById('stat-waiting').textContent    = s.WAITING_INPUT || 0;
  document.getElementById('stat-open').textContent       = s.OPEN          || 0;
}

function updateBadges() {
  document.getElementById('badge-active').textContent   = getActiveTickets().length;
  document.getElementById('badge-archived').textContent = getArchivedTickets().length;
}

function updateTimestamp() {
  const ts = new Date(STATE.data.generated);
  document.getElementById('sidebar-timestamp').textContent =
    'Parsed: ' + ts.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function hideLoading() { document.getElementById('loading-screen')?.remove(); }

function showError(err) {
  document.getElementById('content').innerHTML = `
    <div class="error-card fade-in">
      <h2>⚠ Could not load data</h2>
      <p>Make sure the server is running:</p>
      <code>cd dashboard && node server.js</code>
      <p style="margin-top:8px;font-size:11px;color:var(--text-muted)">${err.message}</p>
    </div>`;
}

// =========================================================================
// REPO SELECTOR
// =========================================================================

function populateRepoSelector() {
  const sel = document.getElementById('repo-select');
  if (!sel || !STATE.data?.repos) return;
  const cur = STATE.selectedRepo;
  sel.innerHTML = '<option value="">All Repos</option>';
  for (const r of STATE.data.repos) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.label;
    if (r.id === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

function bindRepoSelector() {
  const sel = document.getElementById('repo-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    STATE.selectedRepo = sel.value;
    STATE.filters = { search:'', workstream:'', phase:'', team:'', priority:'', status:'' };
    updateSidebarStats();
    updateBadges();
    renderView(STATE.currentView);
  });
}

function getActiveTickets() {
  if (!STATE.data) return [];
  const all = STATE.data.tickets.active;
  return STATE.selectedRepo ? all.filter(t => t.repoId === STATE.selectedRepo) : all;
}
function getArchivedTickets() {
  if (!STATE.data) return [];
  const all = STATE.data.tickets.archived;
  return STATE.selectedRepo ? all.filter(t => t.repoId === STATE.selectedRepo) : all;
}
function getProgrammes() {
  if (!STATE.data) return [];
  const all = STATE.data.programmes || [];
  return STATE.selectedRepo ? all.filter(p => p.repoId === STATE.selectedRepo) : all;
}

// =========================================================================
// SSE
// =========================================================================

let sseSource = null;

function connectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
  setSseStatus('connecting');
  sseSource = new EventSource(WATCH_URL);
  sseSource.onopen = () => setSseStatus('connected');
  sseSource.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      switch (msg.event) {
        case 'reload':
          setSseStatus('reloading');
          await loadData();
          if (STATE.currentView === 'audit' || STATE.currentView === 'overview') {
            await loadAudit();
          }
          renderView(STATE.currentView);
          setSseStatus('connected');
          break;
        case 'process.start':
          onProcessStart(msg.meta);
          if (msg.meta?.isFleet) {
            STATE.fleetProcessIds.add(msg.meta.processId);
            updateFleetBadge();
            if (STATE.currentView === 'fleet') renderFleet(document.getElementById('content'));
          }
          break;
        case 'process.log':
          onProcessLog(msg);
          break;
        case 'process.pty':
          onProcessPty(msg.processId, msg.data, msg.ts);
          break;
        case 'process.prefire':
          onProcessPrefire(msg.processId, msg.prefireDeadline);
          break;
        case 'process.seeded':
          onProcessSeeded(msg.processId);
          break;
        case 'process.prefire_paused':
          onProcessPrefirePaused(msg.processId);
          break;
        case 'process.limit_hit':
          if (msg.meta) onProcessEnd(msg.meta);
          break;
        case 'process.end':
          onProcessEnd(msg.meta);
          if (STATE.currentView === 'fleet') renderFleet(document.getElementById('content'));
          break;
        case 'fleet.stop':
          STATE.fleetProcessIds.clear();
          updateFleetBadge();
          if (STATE.currentView === 'fleet') renderFleet(document.getElementById('content'));
          break;
        case 'process.loop_warning':
          STATE.processLoopFlags = STATE.processLoopFlags || {};
          STATE.processLoopFlags[msg.processId] = { msg: msg.msg, toolCallCount: msg.toolCallCount };
          renderConsoleTabs();
          break;
        case 'process.cleared':
          for (const [id, p] of STATE.processes) {
            if (p.meta.status !== 'running' && p.meta.status !== 'pre-fire') STATE.processes.delete(id);
          }
          renderConsoleTabs();
          updateShellCounter();
          break;
        case 'audit':
          STATE.audit.push(msg.entry);
          document.getElementById('runtime-audit').textContent = STATE.audit.length;
          document.getElementById('badge-audit').textContent   = STATE.audit.length;
          if (STATE.currentView === 'audit') renderView('audit');
          break;
      }
    } catch {}
  };
  sseSource.onerror = () => {
    setSseStatus('disconnected');
    sseSource.close();
    sseSource = null;
    setTimeout(connectSSE, 5000);
  };
}

function setSseStatus(state) {
  const dot   = document.getElementById('sse-dot');
  const label = document.getElementById('sse-label');
  if (!dot || !label) return;
  dot.className = 'sse-dot sse-' + state;
  const labels = { connecting:'Connecting…', connected:'Live', reloading:'Refreshing…', disconnected:'Offline' };
  label.textContent = labels[state] || state;
}

// =========================================================================
// ROUTING
// =========================================================================

function routeFromHash() {
  const hash = location.hash.replace('#', '') || 'overview';
  navigateTo(hash, true);
}

function navigateTo(view, skipHash = false) {
  STATE.currentView = view;
  if (!skipHash) location.hash = view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  const labels = {
    overview:'Programme Overview', programme:'Programme Deep-Dive',
    board:'Ticket Board', fleet:'Fleet Dispatch', graph:'Dependency Graph', archive:'Archive',
    control:'Control Center', org:'Org / Team Builder', audit:'Audit Log',
  };
  document.getElementById('topbar-view-label').textContent = labels[view] || view;
  if (!STATE.data) return;
  closeDetailPanel();
  renderView(view);
}

function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.view); });
  });
}
function bindRefresh() {
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await loadData();
    await loadAudit();
    renderView(STATE.currentView);
  });
}

function renderView(view) {
  const c = document.getElementById('content');
  c.scrollTop = 0;
  switch (view) {
    case 'overview':  renderOverview(c);  break;
    case 'programme': renderProgramme(c); break;
    case 'board':     renderBoard(c);     break;
    case 'fleet':     renderFleet(c);     break;
    case 'graph':     renderGraph(c);     break;
    case 'archive':   renderArchive(c);   break;
    case 'control':   renderControl(c);   break;
    case 'org':       renderOrg(c);       break;
    case 'audit':     renderAudit(c);     break;
    case 'codebase':  renderCodebaseMap(c); break;
    default:          renderOverview(c);
  }
}

// =========================================================================
// HELPERS
// =========================================================================

function wsColor(ws)      { return WS_COLORS[ws]      || WS_COLORS['none']; }
function statusColor(s)   { return STATUS_COLORS[s]   || '#64748b'; }
function priorityColor(p) { return PRIORITY_COLORS[p] || '#64748b'; }

function statusBadge(s) { return `<span class="status-badge status-${s}">${STATUS_LABELS[s]||s}</span>`; }
function wsBadge(ws) {
  if (!ws || ws === 'none') return '';
  const c = wsColor(ws);
  return `<span class="tag tag-ws bg-ws-${ws}" style="color:${c}">${ws.replace('WS-','')}</span>`;
}
function priorityBadge(p) {
  if (!p) return '';
  const c = priorityColor(p);
  return `<span class="tag tag-priority" style="background:${c}1a;color:${c}">${p}</span>`;
}
function formatDate(d) { return d ? String(d).substring(0,10) : '—'; }

function safeHTML(s) {
  const d = document.createElement('div');
  d.textContent = (s == null) ? '' : String(s);
  return d.innerHTML;
}

function getFilteredTickets() {
  const f = STATE.filters;
  return getActiveTickets().filter(t => {
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!t.id.toLowerCase().includes(q) && !t.title.toLowerCase().includes(q)) return false;
    }
    if (f.workstream && t.workstream !== f.workstream && !(f.workstream === 'none' && !t.workstream)) return false;
    if (f.phase    && t.phase    !== f.phase)    return false;
    if (f.team     && !(t.team||'').toLowerCase().includes(f.team.toLowerCase())) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.status   && t.status   !== f.status)   return false;
    return true;
  });
}

window.applyStatusFilter = function(status) {
  STATE.filters.status = status;
  navigateTo('board');
};

// =========================================================================
// VIEW: OVERVIEW (Paperclip-grade multi-repo)
// =========================================================================

function renderOverview(container) {
  const allActive   = STATE.data.tickets.active;
  const allArchived = STATE.data.tickets.archived;
  const repos       = STATE.data.repos || [];
  const activeProcessCount = Array.from(STATE.processes.values()).filter(p => p.meta.status === 'running').length;

  // KPIs
  const blocked = allActive.filter(t => t.status === 'BLOCKED').length;
  const inProg  = allActive.filter(t => t.status === 'IN_PROGRESS').length;
  const waiting = allActive.filter(t => t.status === 'WAITING_INPUT').length;

  const kpisHtml = `
    <div class="zaf-kpi accent"><div class="zaf-kpi-label">Active tickets</div><div class="zaf-kpi-value">${allActive.length}</div><div class="zaf-kpi-delta">across ${repos.length} repos</div></div>
    <div class="zaf-kpi"><div class="zaf-kpi-label">In progress</div><div class="zaf-kpi-value">${inProg}</div><div class="zaf-kpi-delta">live execution</div></div>
    <div class="zaf-kpi"><div class="zaf-kpi-label">Blocked</div><div class="zaf-kpi-value" style="color:var(--status-blocked)">${blocked}</div><div class="zaf-kpi-delta">need unblock</div></div>
    <div class="zaf-kpi"><div class="zaf-kpi-label">Waiting</div><div class="zaf-kpi-value" style="color:var(--status-waiting)">${waiting}</div><div class="zaf-kpi-delta">human input</div></div>
    <div class="zaf-kpi"><div class="zaf-kpi-label">Subshells</div><div class="zaf-kpi-value" style="color:var(--indigo-400)">${activeProcessCount}</div><div class="zaf-kpi-delta">running now</div></div>
  `;

  // Per-repo cards
  const repoCardsHtml = repos.map(r => {
    const repoActive   = allActive.filter(t => t.repoId === r.id);
    const repoArchived = allArchived.filter(t => t.repoId === r.id);
    const byStatus = {};
    for (const t of repoActive) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

    const kanbanCells = STATUS_ORDER.map(s => `
      <div class="zaf-kanban-cell" title="${STATUS_LABELS[s]}: ${byStatus[s]||0}">
        <div class="kc-count" style="color:${statusColor(s)}">${byStatus[s] || 0}</div>
        <div class="kc-label">${(STATUS_LABELS[s]||s).split(' ')[0]}</div>
        <div class="kc-bar" style="background:${statusColor(s)}"></div>
      </div>`).join('');

    // Analyst load: tickets per role
    const loadByRole = {};
    for (const t of repoActive) {
      const roles = (t.roles && t.roles.length) ? t.roles : ['unassigned'];
      for (const role of roles) loadByRole[role] = (loadByRole[role] || 0) + 1;
    }
    const maxLoad = Math.max(1, ...Object.values(loadByRole));
    const analystRows = Object.entries(loadByRole)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 6)
      .map(([role, n]) => `
        <div class="zaf-analyst-row">
          <div class="zaf-analyst-name">${safeHTML(role)}</div>
          <div class="zaf-analyst-bar"><div class="zaf-analyst-fill" style="width:${(n/maxLoad*100).toFixed(0)}%"></div></div>
          <div class="zaf-analyst-count">${n}</div>
        </div>`).join('');

    return `
      <div class="zaf-repo-card" data-repo="${safeHTML(r.id)}">
        <div class="zaf-repo-card-top">
          <div>
            <div class="zaf-repo-name">${safeHTML(r.id)}</div>
            <div class="zaf-repo-label">${safeHTML(r.label)}</div>
          </div>
          <div class="zaf-repo-totals">
            <div class="zaf-repo-active">${repoActive.length}</div>
            <div class="zaf-repo-active-label">active</div>
          </div>
        </div>
        <div class="zaf-kanban-gauge">${kanbanCells}</div>
        <div class="zaf-analyst-load">
          <div class="zaf-analyst-load-title"><span>Analyst load (per role)</span><span>${Object.keys(loadByRole).length} roles</span></div>
          ${analystRows || '<div style="font-size:10px;color:var(--text-muted);padding:6px 0">No assigned roles.</div>'}
        </div>
        <div class="zaf-repo-footer">
          <span>Archived <strong>${repoArchived.length}</strong></span>
          <span>Total <strong>${repoActive.length + repoArchived.length}</strong></span>
        </div>
      </div>`;
  }).join('');

  // Aggregate phase strip (across all programmes, dedup by title)
  const programmes = STATE.data.programmes || [];
  const allPhases = [];
  const seenPhase = new Set();
  for (const p of programmes) {
    for (const ph of (p.phases || [])) {
      const key = (p.repoId || '') + '|' + ph.title;
      if (!seenPhase.has(key)) {
        seenPhase.add(key);
        allPhases.push({ ...ph, repoId: p.repoId });
      }
    }
  }
  const phasesHtml = allPhases.slice(0, 12).map(ph => `
    <div class="zaf-phase-chip ${ph.gateStatus.toLowerCase()}">
      <div class="ph-dot"></div>
      <div class="ph-title">${safeHTML(ph.title)}</div>
      <div class="ph-status">${ph.gateStatus}</div>
    </div>`).join('');

  container.innerHTML = `
    <div class="zaf-overview fade-in">
      <div class="zaf-overview-header">
        <div>
          <div class="zaf-overview-title"><div class="accent-bar"></div>Sovereign Multi-Workspace Overview</div>
          <div class="zaf-overview-sub">Unified view across ${repos.length} repositories — live telemetry, analyst load, and phase gate status.</div>
        </div>
        <div class="zaf-overview-kpis">${kpisHtml}</div>
      </div>

      <div class="zaf-overview-section">
        <div class="zaf-section-title"><div class="accent-dot"></div>Repositories</div>
        <div class="zaf-repo-grid">${repoCardsHtml || '<div style="color:var(--text-muted)">No repos discovered.</div>'}</div>
      </div>

      ${phasesHtml ? `
      <div class="zaf-overview-section">
        <div class="zaf-section-title"><div class="accent-dot"></div>Phase Gate Status</div>
        <div class="zaf-phase-strip">${phasesHtml}</div>
      </div>` : ''}
    </div>`;

  container.querySelectorAll('.zaf-repo-card[data-repo]').forEach(card => {
    card.addEventListener('click', () => {
      const repoId = card.dataset.repo;
      STATE.selectedRepo = repoId;
      const sel = document.getElementById('repo-select');
      if (sel) sel.value = repoId;
      updateSidebarStats(); updateBadges();
      navigateTo('board');
    });
  });
}

// =========================================================================
// VIEW: FLEET
// =========================================================================

function updateFleetBadge() {
  const active = Array.from(STATE.fleetProcessIds)
    .map(id => STATE.processes.get(id)?.meta)
    .filter(m => m && (m.status === 'running' || m.status === 'pre-fire')).length;
  const el = document.getElementById('badge-fleet');
  if (el) el.textContent = active || STATE.fleetProcessIds.size || '—';
}

function renderFleet(container) {
  const tickets = getActiveTickets();
  const fleetMetas = Array.from(STATE.fleetProcessIds)
    .map(id => STATE.processes.get(id)?.meta)
    .filter(Boolean);
  const activeFleet = fleetMetas.filter(m => m.status === 'running' || m.status === 'pre-fire');

  const harnesses = ['mock', 'claude-code', 'codex', 'gemini-cli', 'zo'];
  const defaultHarness = STATE.config?.agents?.engineering?.harness || 'mock';

  const gridRows = fleetMetas.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">No fleet runs yet — dispatch below</td></tr>`
    : fleetMetas.map(m => {
        const elapsed = m.durationSec != null
          ? m.durationSec.toFixed(1) + 's'
          : ((Date.now() - m.startTime) / 1000).toFixed(1) + 's';
        const statusColor = {
          running:'#6366f1', 'pre-fire':'#f59e0b', completed:'#22c55e',
          failed:'#ef4444', killed:'#64748b', paused_rate_limit:'#f97316',
        }[m.status] || '#94a3b8';
        return `<tr data-pid="${m.processId}">
          <td><code style="font-size:11px">${m.ticketId}</code></td>
          <td>${m.harness === 'mock' ? '<span title="Test-only harness. Produces synthetic agent output to validate the ZAF pipeline without consuming AI credits. Not a real AI.">Simulator</span>' : m.harness}</td>
          <td>${m.role}</td>
          <td><span style="color:${statusColor};font-weight:600">${m.status}</span></td>
          <td>${elapsed}</td>
          <td>
            <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px"
              onclick="openConsoleForProcess('${m.processId}')">PTY</button>
          </td>
        </tr>`;
      }).join('');

  const ticketPickerRows = tickets.map(t => {
    const sel = STATE.fleetSelectedTickets.has(t.id);
    return `<tr class="fleet-picker-row${sel ? ' selected' : ''}" data-ticket-id="${t.id}">
      <td><input type="checkbox" class="fleet-chk" data-id="${t.id}" ${sel ? 'checked' : ''} /></td>
      <td><code style="font-size:11px">${t.id}</code></td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title}</td>
      <td><span style="color:${STATUS_COLORS[t.status]||'#94a3b8'};font-size:11px">${t.status}</span></td>
    </tr>`;
  }).join('');

  const harnessOptions = harnesses.map(h => `<option value="${h}"${h===defaultHarness?' selected':''}>${displayHarness(h)}</option>`).join('');

  container.innerHTML = `
    <div class="view-content fade-in">
      <div class="view-header">
        <h1 class="view-title">Fleet Dispatch</h1>
        <div class="view-actions">
          <button class="btn btn-danger" id="fleet-stop-btn" ${activeFleet.length===0?'disabled':''}>
            ⏻ Stop Fleet (${activeFleet.length} active)
          </button>
        </div>
      </div>

      <section class="fleet-section">
        <h3 style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:12px">Live Grid</h3>
        <div class="fleet-grid-wrapper">
          <table class="fleet-grid">
            <thead>
              <tr>
                <th>Ticket</th><th>Harness</th><th>Role</th><th>Status</th><th>Elapsed</th><th>PTY</th>
              </tr>
            </thead>
            <tbody id="fleet-grid-body">
              ${gridRows}
            </tbody>
          </table>
        </div>
      </section>

      <section class="fleet-section" style="margin-top:24px">
        <h3 style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:12px">Dispatch Tickets</h3>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--text-muted)">Harness:</label>
          <select id="fleet-harness-select" class="filter-select" style="width:140px">
            ${harnessOptions}
          </select>
          <label style="font-size:12px;color:var(--text-muted)">Role:</label>
          <input id="fleet-role-input" class="filter-input" style="width:120px" value="engineering" placeholder="role" />
          <button class="btn btn-primary" id="fleet-dispatch-btn">⚡ Dispatch Selected</button>
          <button class="btn btn-secondary" id="fleet-select-all-btn">Select All</button>
          <button class="btn btn-secondary" id="fleet-deselect-all-btn">Deselect All</button>
        </div>
        <div class="fleet-picker-wrapper">
          <table class="fleet-grid">
            <thead>
              <tr>
                <th style="width:32px"></th>
                <th>ID</th><th>Title</th><th>Status</th>
              </tr>
            </thead>
            <tbody id="fleet-picker-body">
              ${ticketPickerRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px">No active tickets</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;

  // Bind Live Grid row click → open PTY (TKT-ZAF-0020)
  container.querySelectorAll('#fleet-grid-body tr[data-pid]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openConsoleForProcess(row.dataset.pid);
    });
  });

  // Bind Stop Fleet
  container.querySelector('#fleet-stop-btn')?.addEventListener('click', async () => {
    if (!confirm('Stop all fleet processes?')) return;
    await fetch('/api/fleet/stop', { method: 'POST' });
  });

  // Bind dispatch
  container.querySelector('#fleet-dispatch-btn')?.addEventListener('click', async () => {
    const harness = container.querySelector('#fleet-harness-select')?.value || defaultHarness;
    const role    = container.querySelector('#fleet-role-input')?.value || 'engineering';
    const ticketIds = Array.from(STATE.fleetSelectedTickets);
    if (ticketIds.length === 0) { alert('Select at least one ticket'); return; }
    const ticketsList = ticketIds.map(id => ({ ticketId: id, role, harness }));
    const r = await fetch('/api/fleet/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickets: ticketsList }),
    });
    const data = await r.json();
    if (data.dispatched) {
      data.dispatched.forEach(pid => STATE.fleetProcessIds.add(pid));
      updateFleetBadge();
      STATE.fleetSelectedTickets.clear();
      renderFleet(container);
    }
  });

  // Bind checkboxes
  container.querySelectorAll('.fleet-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      if (chk.checked) STATE.fleetSelectedTickets.add(chk.dataset.id);
      else STATE.fleetSelectedTickets.delete(chk.dataset.id);
      chk.closest('tr')?.classList.toggle('selected', chk.checked);
    });
  });

  // Row click toggles checkbox
  container.querySelectorAll('.fleet-picker-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT') return;
      const chk = row.querySelector('.fleet-chk');
      if (!chk) return;
      chk.checked = !chk.checked;
      chk.dispatchEvent(new Event('change'));
    });
  });

  // Select/deselect all
  container.querySelector('#fleet-select-all-btn')?.addEventListener('click', () => {
    tickets.forEach(t => STATE.fleetSelectedTickets.add(t.id));
    renderFleet(container);
  });
  container.querySelector('#fleet-deselect-all-btn')?.addEventListener('click', () => {
    STATE.fleetSelectedTickets.clear();
    renderFleet(container);
  });
}

function openConsoleForProcess(processId) {
  STATE.activeProcessTab = processId;
  openConsolePanel();
  renderConsoleTabs();
  document.getElementById('topbar-console-toggle')?.classList.add('active');
}

// =========================================================================
// VIEW: BOARD
// =========================================================================

function renderBoard(container) {
  const tickets = getFilteredTickets();
  const active  = getActiveTickets();

  const workstreams = [...new Set(active.map(t => t.workstream).filter(Boolean))].sort();
  const phases      = [...new Set(active.map(t => t.phase).filter(Boolean))].sort();
  const priorities  = ['P0','P1','P2','P3'];

  const opt = (val, sel, label) => `<option value="${val}" ${sel===val?'selected':''}>${label}</option>`;
  const wsOptions     = `<option value="">All Workstreams</option>` + workstreams.map(w => opt(w, STATE.filters.workstream, w)).join('');
  const phaseOptions  = `<option value="">All Phases</option>`      + phases.map(p => opt(p, STATE.filters.phase, p)).join('');
  const statusOptions = `<option value="">All Statuses</option>`    + STATUS_ORDER.map(s => opt(s, STATE.filters.status, STATUS_LABELS[s])).join('');
  const prioOptions   = `<option value="">All Priorities</option>`  + priorities.map(p => opt(p, STATE.filters.priority, p)).join('');

  const groups = {};
  for (const s of STATUS_ORDER) groups[s] = [];
  for (const t of tickets) (groups[STATUS_ORDER.includes(t.status) ? t.status : 'OPEN']).push(t);

  const columns = STATUS_ORDER.map(s => {
    const col = groups[s] || [];
    return `
      <div class="board-column">
        <div class="column-header">
          <div class="column-dot" style="background:${statusColor(s)}"></div>
          <div class="column-title">${STATUS_LABELS[s]||s}</div>
          <div class="column-count">${col.length}</div>
        </div>
        <div class="column-cards">
          ${col.map(renderTicketCard).join('') || `<div style="padding:12px 8px;font-size:11px;color:var(--text-muted);text-align:center">No tickets</div>`}
        </div>
      </div>`;
  }).join('');

  const hasFilters = Object.values(STATE.filters).some(v => v !== '');

  container.innerHTML = `
    <div class="view-board fade-in">
      <div class="board-toolbar">
        <input class="search-input" id="board-search" type="text" placeholder="Search by ID or title…" value="${safeHTML(STATE.filters.search)}" />
        <select class="filter-select" id="filter-ws">${wsOptions}</select>
        <select class="filter-select" id="filter-phase">${phaseOptions}</select>
        <select class="filter-select" id="filter-status">${statusOptions}</select>
        <select class="filter-select" id="filter-priority">${prioOptions}</select>
        ${hasFilters ? `<span class="filter-clear" id="filter-clear">✕ Clear filters</span>` : ''}
        <div class="board-result-count">${tickets.length} of ${active.length} tickets</div>
      </div>
      <div class="board-columns">${columns}</div>
    </div>`;

  container.querySelector('#board-search')?.addEventListener('input', e => { STATE.filters.search = e.target.value; renderBoard(container); });
  container.querySelector('#filter-ws')?.addEventListener('change', e => { STATE.filters.workstream = e.target.value; renderBoard(container); });
  container.querySelector('#filter-phase')?.addEventListener('change', e => { STATE.filters.phase = e.target.value; renderBoard(container); });
  container.querySelector('#filter-status')?.addEventListener('change', e => { STATE.filters.status = e.target.value; renderBoard(container); });
  container.querySelector('#filter-priority')?.addEventListener('change', e => { STATE.filters.priority = e.target.value; renderBoard(container); });
  container.querySelector('#filter-clear')?.addEventListener('click', () => { STATE.filters = { search:'', workstream:'', phase:'', team:'', priority:'', status:'' }; renderBoard(container); });
  container.querySelectorAll('.ticket-card[data-id]').forEach(card => card.addEventListener('click', () => openDetailPanel(card.dataset.id)));
}

function renderTicketCard(t) {
  const blockerCount = t.blocked_by?.filter(b => !b.startsWith('ENZO')).length || 0;
  const blocksCount  = t.blocks?.length || 0;
  const showRepo     = !STATE.selectedRepo && t.repoId;
  const tags = [
    wsBadge(t.workstream),
    priorityBadge(t.priority),
    showRepo ? `<span class="tag tag-repo">${safeHTML(t.repoId)}</span>` : '',
    t.team ? `<span class="tag tag-team">${safeHTML(t.team.split('+')[0].trim())}</span>` : '',
    blockerCount > 0 ? `<span class="tag tag-blocked">⊗ ${blockerCount} blocker${blockerCount>1?'s':''}</span>` : '',
  ].filter(Boolean).join('');
  const leftBorder = t.blocked_by?.length ? '#ef4444' :
    t.status === 'IN_PROGRESS' ? '#6366f1' :
    t.workstream ? wsColor(t.workstream) : '#333';
  return `
    <div class="ticket-card" data-id="${t.id}" style="border-left:3px solid ${leftBorder}20">
      <div class="ticket-card-id">${t.id}</div>
      <div class="ticket-card-title">${safeHTML(t.title)}</div>
      <div class="ticket-card-tags">${tags}</div>
      <div class="ticket-card-footer">
        <span class="ticket-card-date">${formatDate(t.updated)}</span>
        ${blocksCount > 0 ? `<span class="ticket-card-blockers" title="Blocks ${blocksCount} ticket(s)">→ ${blocksCount}</span>` : ''}
      </div>
    </div>`;
}

// =========================================================================
// DETAIL PANEL + RUN AGENT
// =========================================================================

function bindDetailClose() { document.getElementById('detail-close').addEventListener('click', closeDetailPanel); }
function closeDetailPanel() {
  document.getElementById('detail-panel').classList.add('hidden');
  STATE.selectedTicketId = null;
}

function openDetailPanel(id) {
  const t = STATE.ticketMap[id];
  if (!t) return;
  STATE.selectedTicketId = id;
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');

  const runBtn = document.getElementById('detail-run-btn');
  if (runBtn) {
    if (t.status !== 'DONE' && t.status !== 'ARCHIVED') runBtn.classList.remove('hidden');
    else runBtn.classList.add('hidden');
    runBtn.textContent = '▶ Run Agent…';
    runBtn.onclick = () => openLaunchPopover(t);
  }

  document.getElementById('detail-id').textContent    = t.id;
  document.getElementById('detail-title').textContent = t.title;

  const LIFECYCLE_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'];
  const isArchived = t.status === 'VOIDED' || !getActiveTickets().find(a => a.id === t.id);
  const statusDropdownHtml = isArchived ? statusBadge(t.status) : `
    <select id="detail-status-select" class="zaf-status-select" data-current="${t.status}">
      ${LIFECYCLE_STATUSES.map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${STATUS_LABELS[s] || s}</option>`).join('')}
    </select>`;
  const archiveVoidHtml = isArchived ? '' : `
    <button id="detail-archive-btn" class="zaf-btn secondary" style="margin-left:8px;font-size:10px;padding:3px 8px">Archive</button>
    <button id="detail-void-btn" class="zaf-btn secondary" style="margin-left:4px;font-size:10px;padding:3px 8px;color:var(--amber-400)">Void</button>`;

  document.getElementById('detail-meta-row').innerHTML = [
    statusDropdownHtml,
    wsBadge(t.workstream),
    priorityBadge(t.priority),
    t.phase ? `<span class="tag tag-team">${t.phase}</span>` : '',
    t.archetype ? `<span class="tag tag-archetype">${t.archetype}</span>` : '',
    t.repoId ? `<span class="tag tag-repo">${safeHTML(t.repoId)}</span>` : '',
    archiveVoidHtml,
  ].filter(Boolean).join('');

  // Bind status dropdown
  const statusSel = document.getElementById('detail-status-select');
  if (statusSel) {
    statusSel.addEventListener('change', async () => {
      const newStatus = statusSel.value;
      if (newStatus === statusSel.dataset.current) return;
      const r = await fetch(`/api/ticket/${encodeURIComponent(t.id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, repo: t.repoId }),
      });
      if (!r.ok) { alert('Status update failed: HTTP ' + r.status); statusSel.value = statusSel.dataset.current; return; }
      statusSel.dataset.current = newStatus;
      t.status = newStatus;
    });
  }

  // Bind archive button
  const archiveBtn = document.getElementById('detail-archive-btn');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      if (!confirm(`Archive ${t.id}? It will be moved to ARCHIVED/.`)) return;
      const r = await fetch(`/api/ticket/${encodeURIComponent(t.id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: t.repoId }),
      });
      if (!r.ok) { alert('Archive failed: HTTP ' + r.status); return; }
      closeDetailPanel();
    });
  }

  // Bind void button
  const voidBtn = document.getElementById('detail-void-btn');
  if (voidBtn) {
    voidBtn.addEventListener('click', async () => {
      if (!confirm(`Void ${t.id}? This marks it VOIDED and moves it to ARCHIVED/.`)) return;
      const r = await fetch(`/api/ticket/${encodeURIComponent(t.id)}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: t.repoId }),
      });
      if (!r.ok) { alert('Void failed: HTTP ' + r.status); return; }
      closeDetailPanel();
    });
  }

  const metaFields = [
    ['Programme', t.programme || '—'], ['Team', t.team || '—'],
    ['Phase', t.phase || '—'], ['Priority', t.priority || '—'],
    ['Archetype', t.archetype || '—'], ['Project', t.project || '—'],
    ['Repo', t.repo || '—'], ['Created', formatDate(t.created)],
    ['Updated', formatDate(t.updated)], ['Usage', t.usage_checkpoint || '—'],
  ];
  document.getElementById('detail-meta-grid').innerHTML = metaFields.map(([l,v]) =>
    `<div class="meta-field"><div class="meta-label">${l}</div><div class="meta-value">${safeHTML(String(v))}</div></div>`).join('');

  const depsEl = document.getElementById('detail-deps');
  const blockedBy = t.blocked_by || [];
  const blocks = t.blocks || [];
  if (blockedBy.length || blocks.length) {
    depsEl.style.display = 'block';
    depsEl.innerHTML = `
      ${blockedBy.length ? `<div class="deps-title">Blocked by</div><div class="deps-chips">${blockedBy.map(b => `<span class="dep-chip blocked-by" data-id="${b}">⊗ ${b}</span>`).join('')}</div>` : ''}
      ${blocks.length    ? `<div class="deps-title" style="margin-top:10px">Blocks</div><div class="deps-chips">${blocks.map(b => `<span class="dep-chip blocks" data-id="${b}">→ ${b}</span>`).join('')}</div>` : ''}`;
    depsEl.querySelectorAll('.dep-chip[data-id]').forEach(c => c.addEventListener('click', () => openDetailPanel(c.dataset.id)));
  } else depsEl.style.display = 'none';

  const bodyEl = document.getElementById('detail-markdown');
  if (t.body && typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    bodyEl.innerHTML = `<div class="md-content">${marked.parse(t.body)}</div>`;
    bodyEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.disabled = true);
  } else {
    bodyEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px">${safeHTML(t.body || 'No body.')}</div>`;
  }

  panel.classList.add('slide-in');
  setTimeout(() => panel.classList.remove('slide-in'), 300);
}

// Real model IDs per harness (TKT-ZAF-0029)
const HARNESS_MODEL_IDS = {
  'claude-code': [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast, low cost' },
    { id: 'claude-sonnet-4-6',          label: 'Sonnet 4.6 — balanced' },
    { id: 'claude-opus-4-7',            label: 'Opus 4.7 — highest capability' },
  ],
  'claude': [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast, low cost' },
    { id: 'claude-sonnet-4-6',          label: 'Sonnet 4.6 — balanced' },
    { id: 'claude-opus-4-7',            label: 'Opus 4.7 — highest capability' },
  ],
  'codex': [
    { id: 'gpt-5',      label: 'GPT-5 — balanced' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini — fast, low cost' },
    { id: 'o4-mini',    label: 'o4-mini — reasoning' },
  ],
  'antigravity': [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro — highest capability' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — balanced' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — fast' },
  ],
  'gemini-cli': [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro — highest capability' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — balanced' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — fast' },
  ],
};

// Heartbeat tick scale (TKT-ZAF-0046) — piecewise quasi-logarithmic. The slider index walks this
// array so the operator gets fine resolution at the low end (seconds) and broad reach at the
// high end (days). The stored heartbeat value remains in seconds — unchanged data model.
const HEARTBEAT_TICKS = [
  5, 10, 15, 20, 30, 45, 60, 90, 120,                          // seconds tier (1s..2min)
  180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600,            // minute tier (3..60min)
  5400, 7200, 10800, 14400, 21600, 28800, 43200, 64800, 86400, // hour tier (1.5..24h)
  172800, 259200, 345600, 432000, 518400, 604800,              // day tier (2..7d)
];

function formatHeartbeat(seconds) {
  if (seconds <= 120) return `${seconds}s`;
  if (seconds <= 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds <= 86400) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

function heartbeatSecondsToTickIndex(seconds) {
  let bestIdx = 0, bestDiff = Infinity;
  for (let i = 0; i < HEARTBEAT_TICKS.length; i++) {
    const d = Math.abs(HEARTBEAT_TICKS[i] - seconds);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }
  return bestIdx;
}

// Reasoning-effort capability per harness (TKT-ZAF-0044).
// `values: null` means the harness does NOT expose a configurable reasoning level — the control
// is hidden in Agent Builder. claude-code is the only harness ZAF currently wires the value
// through to (via /thinking budget injection, see server.js).
const REASONING_CAPABILITY = {
  'mock':        { values: null, forwarded: false, note: 'Simulator — no reasoning knob.' },
  'claude':      { values: ['low','medium','high'], forwarded: true,
                   note: 'Injected via /thinking budget at T+2s (high=10000, medium=3000, low=0).' },
  'claude-code': { values: ['low','medium','high'], forwarded: true,
                   note: 'Injected via /thinking budget at T+2s (high=10000, medium=3000, low=0).' },
  'codex':       { values: null, forwarded: false,
                   note: 'OpenAI Codex CLI does not expose a runtime reasoning knob; control hidden.' },
  'gemini-cli':  { values: null, forwarded: false,
                   note: 'Gemini CLI has no reasoning-effort flag; control hidden.' },
  'antigravity': { values: null, forwarded: false, note: 'Antigravity has no reasoning-effort flag.' },
};

const ROLE_RECOMMENDATIONS = {
  thinker:  { modelId: 'claude-sonnet-4-6',          reasoning: 'high',   label: 'Sonnet 4.6 + high reasoning' },
  worker:   { modelId: 'claude-haiku-4-5-20251001',  reasoning: 'medium', label: 'Haiku 4.5 + medium reasoning' },
  reviewer: { modelId: 'claude-sonnet-4-6',          reasoning: 'high',   label: 'Sonnet 4.6 + high reasoning' },
};

// Available harness ids (kept in sync with cli/zo.js HARNESS_MAP and server CLI_HARNESS_COMMANDS)
const HARNESS_OPTIONS = [
  { id: 'mock',        label: '⬡ Simulator (test only)', tooltip: 'Test-only harness. Produces synthetic agent output to validate the ZAF pipeline without consuming AI credits. Not a real AI.' },
  { id: 'claude-code', label: 'Claude Code CLI' },
  { id: 'codex',       label: 'OpenAI Codex CLI' },
  { id: 'gemini-cli',  label: 'Gemini CLI' },
];

function displayHarness(h) { return h === 'mock' ? 'Simulator' : h; }

// Merge static harness list with runtime custom harnesses (TKT-ZAF-0019)
function getAllHarnessOptions() {
  const custom = (STATE.config?.customHarnesses || []).map(h => ({
    id: h.id, label: `${h.displayName} (custom)`, tooltip: `Custom harness: ${h.displayName}`,
  }));
  return [...HARNESS_OPTIONS, ...custom];
}

function agentHarnesses(role) {
  // Multi-CLI agents: agent.harnesses (array) takes precedence over single .harness.
  const a = STATE.config?.agents?.[role];
  if (!a) return HARNESS_OPTIONS.map(h => h.id);
  if (Array.isArray(a.harnesses) && a.harnesses.length) return a.harnesses;
  if (a.harness) return [a.harness];
  return HARNESS_OPTIONS.map(h => h.id);
}

function openLaunchPopover(ticket) {
  const existing = document.getElementById('zaf-launch-modal');
  if (existing) existing.remove();

  const roles = (ticket.roles && ticket.roles.length) ? ticket.roles : Object.keys(STATE.config?.agents || { engineering: {} });
  const defaultRole = roles[0] || 'engineering';
  const a = STATE.config?.agents?.[defaultRole] || {};
  const availableHarnesses = agentHarnesses(defaultRole);

  const modal = document.createElement('div');
  modal.id = 'zaf-launch-modal';
  modal.className = 'zaf-launch-modal';
  modal.innerHTML = `
    <div class="zaf-launch-backdrop"></div>
    <div class="zaf-launch-panel">
      <div class="zaf-launch-header">
        <div>
          <div class="zaf-launch-title">▶ Launch agent on <span style="color:var(--indigo-400);font-family:'JetBrains Mono',monospace">${ticket.id}</span></div>
          <div class="zaf-launch-sub">${safeHTML(ticket.title)}</div>
        </div>
        <button class="zaf-launch-close" id="zaf-launch-close" title="Close">✕</button>
      </div>

      <div class="zaf-launch-body">
        <div class="zaf-field">
          <label>Role / Agent</label>
          <select id="zaf-launch-role">
            ${Object.keys(STATE.config?.agents || {}).map(k => `<option value="${k}" ${k===defaultRole?'selected':''}>${STATE.config.agents[k].roleName} (${k})</option>`).join('')}
          </select>
        </div>

        <div class="zaf-field">
          <label>CLI / Harness — pick which command-line agent runs this ticket</label>
          <select id="zaf-launch-harness">
            ${HARNESS_OPTIONS.map(h => {
              const allowed = availableHarnesses.includes(h.id);
              return `<option value="${h.id}" ${h.id === (a.harness || 'mock') ? 'selected' : ''} ${!allowed ? 'data-disabled="1"' : ''}>${h.label}${allowed ? '' : ' — not enabled for this agent'}</option>`;
            }).join('')}
          </select>
          <div class="zaf-heartbeat-hint" id="zaf-harness-note">${a.harness === 'mock' ? 'Simulator streams synthetic telemetry into the multi-console — test-only, does not consume AI credits.' : 'Interactive CLIs need a real terminal — the dashboard will tell you the exact command to paste.'}</div>
        </div>

        <div class="zaf-field">
          <label>Model</label>
          <select id="zaf-launch-model">
            ${(HARNESS_MODEL_IDS[a.harness || 'mock'] || []).map(m => `<option value="${m.id}" ${(a.modelId||'')===m.id?'selected':''}>${m.id} — ${m.label}</option>`).join('') || '<option value="">N/A</option>'}
          </select>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="zaf-field">
            <label>Reasoning</label>
            <select id="zaf-launch-reasoning">
              ${['high','medium','low'].map(r => `<option value="${r}" ${(a.reasoning||'medium')===r?'selected':''}>${r}</option>`).join('')}
            </select>
          </div>
          <div class="zaf-field">
            <label><span>Heartbeat</span><span class="zaf-heartbeat-val" id="zaf-launch-hbval">${a.heartbeat || 40} seconds</span></label>
            <input type="range" id="zaf-launch-hb" min="5" max="300" step="5" value="${a.heartbeat || 40}" />
          </div>
        </div>

        <div class="zaf-field">
          <label>Per-ticket prompt addendum (optional)</label>
          <textarea id="zaf-launch-prompt" rows="3" placeholder="Anything specific you want the agent to know before it starts on this ticket…"></textarea>
        </div>
      </div>

      <div class="zaf-launch-footer">
        <button class="zaf-btn secondary" id="zaf-launch-cancel">Cancel</button>
        <button class="zaf-btn" id="zaf-launch-fire">▶ Launch subshell</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const roleSel    = modal.querySelector('#zaf-launch-role');
  const harnessSel = modal.querySelector('#zaf-launch-harness');
  const hbSlider   = modal.querySelector('#zaf-launch-hb');
  const hbVal      = modal.querySelector('#zaf-launch-hbval');
  const harnessNote = modal.querySelector('#zaf-harness-note');
  const modelSel   = modal.querySelector('#zaf-launch-model');
  const reasoningSel = modal.querySelector('#zaf-launch-reasoning');

  const updateModelOptions = (harness, currentModelId) => {
    if (!modelSel) return;
    const models = HARNESS_MODEL_IDS[harness];
    if (!models) {
      modelSel.innerHTML = '<option value="">N/A</option>';
      modelSel.disabled = true;
    } else {
      modelSel.disabled = false;
      modelSel.innerHTML = models.map(m => `<option value="${m.id}" ${m.id===currentModelId?'selected':''}>${m.id} — ${m.label}</option>`).join('');
    }
  };

  const refreshFromRole = () => {
    const k = roleSel.value;
    const cfg = STATE.config?.agents?.[k] || {};
    const allowed = agentHarnesses(k);
    Array.from(harnessSel.options).forEach(opt => {
      opt.disabled = !allowed.includes(opt.value);
      opt.textContent = HARNESS_OPTIONS.find(h => h.id === opt.value)?.label + (opt.disabled ? ' — not enabled for this agent' : '');
    });
    if (cfg.harness && allowed.includes(cfg.harness)) harnessSel.value = cfg.harness;
    else if (allowed.length) harnessSel.value = allowed[0];
    updateModelOptions(harnessSel.value, cfg.modelId || cfg.customModel || cfg.model || '');
    reasoningSel.value = cfg.reasoning || 'medium';
    hbSlider.value = cfg.heartbeat || 40;
    hbVal.textContent = `${hbSlider.value} seconds`;
    updateNote();
  };
  const updateNote = () => {
    if (harnessSel.value === 'mock') harnessNote.textContent = 'Simulator streams synthetic telemetry into the multi-console — you will see TOOL CALL / API REQUEST / DECISION lines appear live. Test-only, does not consume AI credits.';
    else harnessNote.textContent = 'Interactive CLIs need a real terminal. Dashboard launches will print the exact paste-able command instead of streaming the live CLI.';
  };

  roleSel.addEventListener('change', refreshFromRole);
  harnessSel.addEventListener('change', () => { updateNote(); updateModelOptions(harnessSel.value, modelSel?.value || ''); });
  hbSlider.addEventListener('input', () => { hbVal.textContent = `${hbSlider.value} seconds`; });

  const close = () => modal.remove();
  modal.querySelector('#zaf-launch-close').addEventListener('click', close);
  modal.querySelector('.zaf-launch-backdrop').addEventListener('click', close);
  modal.querySelector('#zaf-launch-cancel').addEventListener('click', close);

  modal.querySelector('#zaf-launch-fire').addEventListener('click', () => {
    const role      = roleSel.value;
    const harness   = harnessSel.value;
    const modelId   = modelSel?.value || '';
    const reasoning = reasoningSel.value;
    const heartbeat = hbSlider.value;
    const prompt    = modal.querySelector('#zaf-launch-prompt').value.trim();
    close();
    triggerAgentRun({
      ticketId: ticket.id,
      role, harness, modelId, reasoning, heartbeat,
      repo: ticket.repoId || '',
      promptAddendum: prompt,
    });
  });

  setTimeout(() => modelSel?.focus(), 50);
}

function triggerAgentRun(opts) {
  const params = new URLSearchParams({
    ticket: opts.ticketId,
    role: opts.role,
    harness: opts.harness,
    modelId: opts.modelId || opts.model || '',
    reasoning: opts.reasoning || '',
    heartbeat: opts.heartbeat || '',
    repo: opts.repo || '',
  });

  openConsolePanel();

  if (typeof window !== 'undefined' && window.__TAURI__) {
    window.__TAURI__.core.invoke('spawn_agent_run', {
      ticketId: opts.ticketId,
      role: opts.role,
      harness: opts.harness,
      model: opts.model || '',
      reasoning: opts.reasoning || '',
      heartbeat: opts.heartbeat || '',
    }).catch(err => console.error('Tauri spawn failed', err));
  }

  fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticket: opts.ticketId,
      role: opts.role,
      harness: opts.harness,
      modelId: opts.modelId || opts.model || '',
      reasoning: opts.reasoning || '',
      heartbeat: opts.heartbeat || '',
      repo: opts.repo || '',
      promptAddendum: opts.promptAddendum || '',
    }),
  })
    .then(r => r.json())
    .then(data => {
      // Server emits process.start via SSE so the tab will appear there.
      console.log('[ZAF] Spawned:', data);
    })
    .catch(err => alert('Failed to spawn agent: ' + err.message));
}

// =========================================================================
// DEPENDENCY GRAPH (kept from baseline, slightly tightened)
// =========================================================================

function renderGraph(container) {
  const graph = STATE.data.graph;
  const active = getActiveTickets();
  const activeIds = new Set(active.map(t => t.id));
  const connected = new Set();
  for (const e of graph.edges) {
    if (activeIds.has(e.from) && activeIds.has(e.to)) { connected.add(e.from); connected.add(e.to); }
  }
  const nodes = graph.nodes.filter(n => connected.has(n.id) && activeIds.has(n.id));
  const edges = graph.edges.filter(e => connected.has(e.from) && connected.has(e.to));
  const filterWs = STATE.filters.workstream || '';
  const wsOptions = [...new Set(active.map(t => t.workstream).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="view-graph fade-in">
      <div class="graph-toolbar">
        <span style="font-size:15px;font-weight:700;color:var(--text-primary)">Dependency Graph</span>
        <select class="filter-select" id="graph-ws-filter">
          <option value="">All Workstreams</option>
          ${wsOptions.map(ws => `<option value="${ws}" ${filterWs===ws?'selected':''}>${ws}</option>`).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-muted)">${nodes.length} nodes · ${edges.length} edges</span>
        <span style="font-size:11px;color:var(--text-muted);font-style:italic">Drag nodes · scroll to zoom · pan background</span>
        <button class="btn btn-secondary" id="graph-reset-zoom">Reset View</button>
      </div>
      <div class="graph-canvas-wrap" id="graph-wrap">
        <svg id="graph-svg" width="100%" height="100%">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="rgba(255,255,255,0.3)"/>
            </marker>
          </defs>
          <g id="graph-root"></g>
        </svg>
      </div>
    </div>`;
  container.querySelector('#graph-ws-filter').addEventListener('change', e => { STATE.filters.workstream = e.target.value; renderGraph(container); });
  drawDraggableGraph(nodes, edges, filterWs);
  container.querySelector('#graph-reset-zoom').addEventListener('click', () => drawDraggableGraph(nodes, edges, filterWs));
}

function drawDraggableGraph(allNodes, allEdges, wsFilter) {
  const svgEl = document.getElementById('graph-svg');
  const root  = document.getElementById('graph-root');
  if (!svgEl || !root) return;
  const nodes = wsFilter ? allNodes.filter(n => n.workstream === wsFilter) : allNodes;
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = allEdges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  if (!nodes.length) { root.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#525970">No connected tickets</text>`; return; }
  const W = svgEl.clientWidth || 900;
  const H = svgEl.clientHeight || 500;
  const NODE_W = 120, NODE_H = 38, MARGIN = 60;
  const pos = {};
  nodes.forEach((n, i) => {
    const cols = Math.ceil(Math.sqrt(nodes.length * 1.5));
    const row = Math.floor(i/cols), col = i % cols;
    pos[n.id] = { x: MARGIN + col*(NODE_W+40) + (row%2?0:(NODE_W+40)/2), y: MARGIN + row*(NODE_H+50) };
  });
  const vel = {};
  nodes.forEach(n => vel[n.id] = { x:0, y:0 });
  for (let it=0; it<80; it++) {
    for (let i=0; i<nodes.length; i++) for (let j=i+1; j<nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = pos[b.id].x - pos[a.id].x, dy = pos[b.id].y - pos[a.id].y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const f = 3000 / (d*d);
      vel[a.id].x -= dx/d*f; vel[a.id].y -= dy/d*f;
      vel[b.id].x += dx/d*f; vel[b.id].y += dy/d*f;
    }
    for (const e of edges) {
      const dx = pos[e.to].x - pos[e.from].x, dy = pos[e.to].y - pos[e.from].y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const f = (d - 180) * 0.05;
      vel[e.from].x += dx/d*f; vel[e.from].y += dy/d*f;
      vel[e.to].x   -= dx/d*f; vel[e.to].y   -= dy/d*f;
    }
    for (const n of nodes) { vel[n.id].x*=0.8; vel[n.id].y*=0.8; pos[n.id].x+=vel[n.id].x; pos[n.id].y+=vel[n.id].y; }
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const n of nodes) { minX=Math.min(minX,pos[n.id].x); minY=Math.min(minY,pos[n.id].y); maxX=Math.max(maxX,pos[n.id].x+NODE_W); maxY=Math.max(maxY,pos[n.id].y+NODE_H); }
  const pad = 40;
  const scale = Math.min((W-pad*2)/((maxX-minX)||1), (H-pad*2)/((maxY-minY)||1), 1.2);
  for (const n of nodes) { pos[n.id].x = pad + (pos[n.id].x-minX)*scale; pos[n.id].y = pad + (pos[n.id].y-minY)*scale; }

  let panX=0, panY=0, zoom=1, isPanning=false, panStartX=0, panStartY=0;
  function apply() { root.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`); }
  function render() {
    const edgesHtml = edges.map(e => {
      const a=pos[e.from], b=pos[e.to];
      const x1=a.x+NODE_W/2, y1=a.y+NODE_H, x2=b.x+NODE_W/2, y2=b.y, my=(y1+y2)/2;
      return `<path class="graph-edge" data-from="${e.from}" data-to="${e.to}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" stroke="${statusColor(STATE.ticketMap[e.from]?.status||'OPEN')}" />`;
    }).join('');
    const nodesHtml = nodes.map(n => {
      const p=pos[n.id], c=statusColor(n.status), title = n.title.length > 20 ? n.title.substring(0,18) + '…' : n.title;
      return `<g class="graph-node" transform="translate(${p.x},${p.y})" data-id="${n.id}">
        <rect class="graph-node-rect" width="${NODE_W}" height="${NODE_H}" fill="${c}22" stroke="${c}" stroke-width="1.5"/>
        <text class="graph-node-id" x="6" y="13">${n.id}</text>
        <text class="graph-node-label" x="6" y="28">${safeHTML(title)}</text></g>`;
    }).join('');
    root.innerHTML = edgesHtml + nodesHtml;
    apply();
    bindNodeDrag();
  }
  function updateEdges() {
    root.querySelectorAll('.graph-edge').forEach(p => {
      const a=pos[p.dataset.from], b=pos[p.dataset.to];
      const x1=a.x+NODE_W/2, y1=a.y+NODE_H, x2=b.x+NODE_W/2, y2=b.y, my=(y1+y2)/2;
      p.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
    });
  }
  function bindNodeDrag() {
    root.querySelectorAll('.graph-node').forEach(el => {
      const id = el.dataset.id;
      let dragging=false, sx=0, sy=0, sPosX=0, sPosY=0;
      el.addEventListener('mousedown', e => {
        e.stopPropagation(); dragging=true;
        sx=e.clientX; sy=e.clientY; sPosX=pos[id].x; sPosY=pos[id].y; el.style.cursor='grabbing'; e.preventDefault();
        function mm(ev) { if (!dragging) return; pos[id].x = sPosX + (ev.clientX-sx)/zoom; pos[id].y = sPosY + (ev.clientY-sy)/zoom; el.setAttribute('transform', `translate(${pos[id].x},${pos[id].y})`); updateEdges(); }
        function mu(ev) { dragging=false; el.style.cursor='pointer'; window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); if (Math.abs(ev.clientX-sx)<5 && Math.abs(ev.clientY-sy)<5) openDetailPanel(id); }
        window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
      });
    });
  }
  svgEl.addEventListener('mousedown', e => { if (e.target.closest('.graph-node')) return; isPanning=true; panStartX=e.clientX-panX; panStartY=e.clientY-panY; svgEl.style.cursor='grabbing'; });
  window.addEventListener('mousemove', e => { if (!isPanning) return; panX=e.clientX-panStartX; panY=e.clientY-panStartY; apply(); });
  window.addEventListener('mouseup', () => { isPanning=false; svgEl.style.cursor='grab'; });
  svgEl.addEventListener('wheel', e => {
    e.preventDefault();
    const oldZoom=zoom; zoom = Math.max(0.2, Math.min(4, zoom + e.deltaY*-0.001));
    const r=svgEl.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    panX = mx - (mx-panX)*(zoom/oldZoom);
    panY = my - (my-panY)*(zoom/oldZoom);
    apply();
  }, { passive:false });
  render();
}

// =========================================================================
// VIEW: ARCHIVE
// =========================================================================

function renderArchive(container) {
  let tickets = [...getArchivedTickets()];
  const sv = STATE.filters.search || '';
  if (sv) {
    const q = sv.toLowerCase();
    tickets = tickets.filter(t => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
  }
  const { col, dir } = STATE.archiveSort;
  tickets.sort((a,b) => {
    let va = a[col] || '', vb = b[col] || '';
    if (col === 'id') {
      va = parseInt(va.replace(/[^0-9]/g,''))||0;
      vb = parseInt(vb.replace(/[^0-9]/g,''))||0;
      return dir==='asc' ? va-vb : vb-va;
    }
    return dir==='asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  const sortIcon = c => STATE.archiveSort.col!==c ? `<span class="sort-icon">↕</span>` : `<span class="sort-icon">${STATE.archiveSort.dir==='asc'?'↑':'↓'}</span>`;
  const rows = tickets.map(t => {
    const voided = t.status === 'VOIDED';
    const rowStyle = voided ? ' style="text-decoration:line-through;opacity:0.55"' : '';
    return `<tr data-id="${t.id}" class="archive-row"${rowStyle}>
      <td class="td-id">${t.id}</td>
      <td class="td-title">${safeHTML(t.title)}</td>
      <td>${wsBadge(t.workstream)}</td>
      <td>${statusBadge(t.status)}</td>
      ${!STATE.selectedRepo ? `<td class="td-repo">${safeHTML(t.repoId||'—')}</td>` : ''}
      <td class="td-date">${formatDate(t.updated)}</td>
    </tr>`;
  }).join('');
  container.innerHTML = `
    <div class="view-archive fade-in">
      <div class="section-header">
        <h1>Archive</h1>
        <span class="section-meta">${tickets.length} of ${getArchivedTickets().length} archived</span>
      </div>
      <div class="board-toolbar" style="background:transparent;padding:0;border:none;margin-bottom:12px">
        <input class="search-input" id="archive-search" type="text" placeholder="Search archived tickets…" value="${safeHTML(sv)}" />
      </div>
      <div class="archive-table-wrap">
        <table class="archive-table">
          <thead><tr>
            <th data-col="id">ID${sortIcon('id')}</th>
            <th data-col="title">Title${sortIcon('title')}</th>
            <th data-col="workstream">Workstream${sortIcon('workstream')}</th>
            <th data-col="status">Status${sortIcon('status')}</th>
            ${!STATE.selectedRepo ? `<th data-col="repoId">Repo${sortIcon('repoId')}</th>` : ''}
            <th data-col="updated">Updated${sortIcon('updated')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  container.querySelectorAll('th[data-col]').forEach(th => th.addEventListener('click', () => {
    const c = th.dataset.col;
    if (STATE.archiveSort.col === c) STATE.archiveSort.dir = STATE.archiveSort.dir === 'asc' ? 'desc' : 'asc';
    else STATE.archiveSort = { col:c, dir:'asc' };
    renderArchive(container);
  }));
  container.querySelector('#archive-search').addEventListener('input', e => { STATE.filters.search = e.target.value; renderArchive(container); });
  container.querySelectorAll('.archive-row[data-id]').forEach(row => row.addEventListener('click', () => openDetailPanel(row.dataset.id)));
}

// =========================================================================
// VIEW: PROGRAMME DEEP DIVE
// =========================================================================

function renderProgramme(container) {
  const allProgs = STATE.data?.programmes || [];
  const progs = STATE.selectedRepo
    ? allProgs.filter(p => p.repoId === STATE.selectedRepo)
    : allProgs;

  if (!progs.length) {
    container.innerHTML = `
      <div class="view-deep-dive fade-in">
        <div class="section-header">
          <h1>Programmes</h1>
          <button id="new-programme-btn" class="zaf-btn" style="margin-left:auto">+ New Programme</button>
        </div>
        <div style="padding:40px;color:var(--text-muted)">No programme data found for selected repo.</div>
      </div>`;
    bindNewProgrammeBtn(container);
    return;
  }

  // Group by programme id (merge if same id appears across repos in All-Repos mode)
  const progMap = new Map();
  for (const p of progs) {
    const key = p.id || p.title || p.repoId;
    if (progMap.has(key)) {
      const existing = progMap.get(key);
      existing.phases = [...(existing.phases || []), ...(p.phases || [])];
      existing.workstreams = [...(existing.workstreams || []), ...(p.workstreams || [])];
      existing.openQuestions = [...(existing.openQuestions || []), ...(p.openQuestions || [])];
      if (p.repoId && !existing.repoIds) existing.repoIds = [existing.repoId, p.repoId];
      else if (p.repoId && existing.repoIds) existing.repoIds.push(p.repoId);
    } else {
      progMap.set(key, { ...p });
    }
  }

  const renderOneProg = (programme) => {
    const phasesHtml = (programme.phases || []).map(ph => {
      const gs = (ph.gateStatus || 'pending').toLowerCase();
      return `<div class="phase-card">
        <div class="phase-dot ${gs}">${gs==='complete'?'✓':gs==='active'?'◉':'○'}</div>
        <div class="phase-body">
          <div class="phase-body-top">
            <div class="phase-title">${safeHTML(ph.title)}</div>
            <div class="phase-status-badge ${gs}">${ph.gateStatus || 'PENDING'}</div>
          </div>
          ${ph.objective ? `<div class="phase-objective">${safeHTML(ph.objective)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    const wsCardsHtml = (programme.workstreams || []).map(ws => {
      const c = wsColor(ws.id);
      return `<div class="ws-deep-card">
        <div class="ws-deep-header"><div class="ws-deep-id" style="color:${c};background:${c}18">${ws.id}</div></div>
        <div class="ws-deep-goal">${safeHTML(ws.goal)}</div>
        ${ws.currentState ? `<div class="ws-deep-state">Current: ${safeHTML(ws.currentState)}</div>` : ''}
      </div>`;
    }).join('');
    const openQs = (programme.openQuestions || []);
    const oqRows = openQs.map(oq => {
      const answered = oq.status === 'ANSWERED';
      return `<tr><td style="font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap">${oq.id}</td><td>${safeHTML(oq.question)}</td><td><span class="status-badge ${answered?'status-DONE':'status-OPEN'}">${answered?'Answered':'Open'}</span></td></tr>`;
    }).join('');
    const repoTag = !STATE.selectedRepo && programme.repoId ? `<span class="tag tag-repo" style="margin-left:8px">${safeHTML(programme.repoId)}</span>` : '';
    return `
      <div class="deep-dive-section" style="margin-bottom:32px;border-bottom:1px solid var(--border-subtle);padding-bottom:24px">
        <h2 style="display:flex;align-items:center;gap:8px">${safeHTML(programme.title)}${repoTag}</h2>
        ${phasesHtml ? `<h3 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 8px">Phase Gates</h3><div class="phase-timeline">${phasesHtml}</div>` : ''}
        ${wsCardsHtml ? `<h3 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 8px">Workstreams</h3>${wsCardsHtml}` : ''}
        ${openQs.length ? `<h3 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 8px">Open Questions</h3><table class="oq-table"><thead><tr><th>ID</th><th>Question</th><th>Status</th></tr></thead><tbody>${oqRows}</tbody></table>` : ''}
      </div>`;
  };

  const allSections = [...progMap.values()].map(renderOneProg).join('');
  container.innerHTML = `
    <div class="view-deep-dive fade-in">
      <div class="section-header">
        <h1>Programmes${!STATE.selectedRepo ? ' — All Repos' : ''}</h1>
        <button id="new-programme-btn" class="zaf-btn" style="margin-left:auto">+ New Programme</button>
      </div>
      ${allSections}
    </div>`;
  bindNewProgrammeBtn(container);
}

function bindNewProgrammeBtn(container) {
  const btn = container.querySelector('#new-programme-btn');
  if (!btn) return;
  btn.addEventListener('click', () => openNewProgrammeModal());
}

function openNewProgrammeModal() {
  const existing = document.getElementById('zaf-programme-modal');
  if (existing) existing.remove();

  const repos = STATE.data?.repos || [];
  const repoOpts = repos.map(r => `<option value="${r.id}">${safeHTML(r.label || r.id)}</option>`).join('');

  const modal = document.createElement('div');
  modal.id = 'zaf-programme-modal';
  modal.className = 'zaf-launch-modal';
  modal.innerHTML = `
    <div class="zaf-launch-backdrop"></div>
    <div class="zaf-launch-panel" style="max-width:440px">
      <div class="zaf-launch-header">
        <span class="zaf-launch-title">New Programme</span>
        <button class="zaf-launch-close" id="prog-modal-close">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;padding:16px 0">
        <div class="zaf-field"><label>Programme ID (e.g. PROG-ZAF-002)</label>
          <input class="zaf-input" id="prog-id" type="text" placeholder="PROG-ZAF-002" /></div>
        <div class="zaf-field"><label>Title</label>
          <input class="zaf-input" id="prog-title" type="text" placeholder="Phase title" /></div>
        <div class="zaf-field"><label>Description (optional)</label>
          <input class="zaf-input" id="prog-desc" type="text" placeholder="Short description" /></div>
        <div class="zaf-field"><label>Phase label (e.g. P9)</label>
          <input class="zaf-input" id="prog-phase" type="text" placeholder="P9" /></div>
        <div class="zaf-field"><label>Default Workstream</label>
          <input class="zaf-input" id="prog-ws" type="text" placeholder="WS-UX" /></div>
        <div class="zaf-field"><label>Target Repo</label>
          <select class="zaf-input" id="prog-repo">${repoOpts}</select></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:8px">
        <button class="zaf-btn secondary" id="prog-modal-cancel">Cancel</button>
        <button class="zaf-btn" id="prog-modal-submit">Create Programme</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('#prog-modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#prog-modal-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('.zaf-launch-backdrop').addEventListener('click', () => modal.remove());

  // Auto-suggest programme ID
  const existing2 = (STATE.data?.programmes || []).map(p => p.id).filter(Boolean);
  const lastNum = existing2.reduce((max, id) => {
    const m = id.match(/(\d+)$/); return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  modal.querySelector('#prog-id').value = `PROG-ZAF-${String(lastNum + 1).padStart(3, '0')}`;

  modal.querySelector('#prog-modal-submit').addEventListener('click', async () => {
    const payload = {
      programmeId: modal.querySelector('#prog-id').value.trim(),
      title: modal.querySelector('#prog-title').value.trim(),
      description: modal.querySelector('#prog-desc').value.trim(),
      phase: modal.querySelector('#prog-phase').value.trim(),
      workstream: modal.querySelector('#prog-ws').value.trim(),
      repo: modal.querySelector('#prog-repo').value,
    };
    if (!payload.title) { alert('Title is required'); return; }
    const r = await fetch('/api/programme/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { alert('Create failed: HTTP ' + r.status); return; }
    modal.remove();
  });
}

// =========================================================================
// NEW REPO WIZARD (TKT-ZAF-0028)
// =========================================================================

function bindNewRepoButton() {
  document.getElementById('sidebar-new-repo')?.addEventListener('click', openNewRepoWizard);
}

function openNewRepoWizard() {
  const existing = document.getElementById('zaf-new-repo-modal');
  if (existing) existing.remove();

  const reposRoot = '/repos'; // server will use REPOS_ROOT; we just show the default path hint
  const agents = STATE.config?.agents || {};
  const agentKeys = Object.keys(agents);
  const harnesses = ['mock', 'claude-code', 'codex', 'gemini-cli'];

  const modal = document.createElement('div');
  modal.id = 'zaf-new-repo-modal';
  modal.className = 'zaf-launch-modal';
  modal.innerHTML = `
    <div class="zaf-launch-backdrop"></div>
    <div class="zaf-launch-panel" style="width:600px;max-width:calc(100vw - 32px)">
      <div class="zaf-launch-header">
        <div>
          <div class="zaf-launch-title">+ New Repository</div>
          <div class="zaf-launch-sub">Create and scaffold a new project repository</div>
        </div>
        <button class="zaf-launch-close" id="nr-close">✕</button>
      </div>
      <div class="zaf-launch-body" id="nr-body">
        <!-- Step 1 rendered here -->
      </div>
      <div class="zaf-launch-footer" id="nr-footer"></div>
    </div>`;
  document.body.appendChild(modal);

  const body = modal.querySelector('#nr-body');
  const footer = modal.querySelector('#nr-footer');
  const close = () => modal.remove();

  modal.querySelector('#nr-close').addEventListener('click', close);
  modal.querySelector('.zaf-launch-backdrop').addEventListener('click', close);

  // Step state
  const form = { name:'', displayName:'', localPath:'', description:'', remoteUrl:'', mode:'manual', templateName:'zaf-standard', agentRole: agentKeys[0] || 'engineering', agentHarness:'claude-code', scaffoldInstructions:'', flow:'create', importMode:'local', cloneTo:'' };

  // Step 0 (TKT-ZAF-0055): pick Create-new vs Import-existing flow.
  function renderStep0() {
    body.innerHTML = `
      <div class="wizard-steps">
        <div class="wizard-step active">0 · Flow</div>
        <div class="wizard-step">1 · Repo Info</div>
        <div class="wizard-step">2 · ${form.flow === 'import' ? 'Confirm' : 'Scaffold'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
        <label class="zaf-flow-card" style="border:1px solid ${form.flow==='create'?'var(--indigo-500,#6366f1)':'var(--border-medium)'};border-radius:6px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:6px;">
          <input type="radio" name="nr-flow" value="create" ${form.flow==='create'?'checked':''} style="margin-bottom:6px"/>
          <strong style="color:var(--text-primary)">Create new repo</strong>
          <span style="font-size:11px;color:var(--text-muted)">Scaffold a fresh repository with ZAF templates and (optionally) dispatch an agent to flesh it out.</span>
        </label>
        <label class="zaf-flow-card" style="border:1px solid ${form.flow==='import'?'var(--indigo-500,#6366f1)':'var(--border-medium)'};border-radius:6px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:6px;">
          <input type="radio" name="nr-flow" value="import" ${form.flow==='import'?'checked':''} style="margin-bottom:6px"/>
          <strong style="color:var(--text-primary)">Import existing repo</strong>
          <span style="font-size:11px;color:var(--text-muted)">Register a repo you already have locally, or clone one from a Git remote. ZAF will NOT modify files in the imported repo.</span>
        </label>
      </div>`;
    footer.innerHTML = `
      <button class="zaf-btn secondary" id="nr-cancel">Cancel</button>
      <button class="zaf-btn" id="nr-step0-next">Next →</button>`;
    footer.querySelector('#nr-cancel').addEventListener('click', close);
    body.querySelectorAll('input[name="nr-flow"]').forEach(r => r.addEventListener('change', () => {
      form.flow = body.querySelector('input[name="nr-flow"]:checked').value;
      renderStep0();
    }));
    footer.querySelector('#nr-step0-next').addEventListener('click', () => {
      if (form.flow === 'import') renderImportStep();
      else renderStep1();
    });
  }

  function renderImportStep() {
    body.innerHTML = `
      <div class="wizard-steps">
        <div class="wizard-step done">0 · Flow ✓</div>
        <div class="wizard-step active">1 · Import</div>
        <div class="wizard-step">2 · Confirm</div>
      </div>
      <div class="zaf-field"><label>Repo id (slug — must be unique)</label>
        <input id="nr-imp-name" placeholder="my-existing-repo" value="${safeHTML(form.name)}" />
      </div>
      <div class="zaf-field"><label>Display name</label>
        <input id="nr-imp-display" placeholder="My Existing Repo" value="${safeHTML(form.displayName)}" />
      </div>
      <div class="zaf-field"><label>Source</label>
        <div class="scaffold-mode-toggle">
          <label><input type="radio" name="nr-imp-mode" value="local" ${form.importMode==='local'?'checked':''}><span>Local folder (already cloned)</span></label>
          <label><input type="radio" name="nr-imp-mode" value="clone" ${form.importMode==='clone'?'checked':''}><span>Clone from Git remote</span></label>
        </div>
      </div>
      <div class="zaf-field" id="nr-imp-local-row" style="${form.importMode==='clone'?'display:none':''}">
        <label>Local path to existing repo (must contain .git/)</label>
        <input id="nr-imp-path" placeholder="C:/Users/LENOVO/Workspace/01_Repos/some-repo" value="${safeHTML(form.localPath)}" />
      </div>
      <div class="zaf-field" id="nr-imp-remote-row" style="${form.importMode==='local'?'display:none':''}">
        <label>Remote URL</label>
        <input id="nr-imp-remote" placeholder="https://github.com/org/repo.git" value="${safeHTML(form.remoteUrl)}" />
        <label style="margin-top:8px">Clone into</label>
        <input id="nr-imp-cloneto" placeholder="C:/Users/LENOVO/Workspace/01_Repos/&lt;repo-id&gt;" value="${safeHTML(form.cloneTo)}" />
      </div>
      <div style="font-size:11px;color:var(--text-muted);background:rgba(99,102,241,0.08);border-left:3px solid var(--indigo-500,#6366f1);padding:8px 10px;border-radius:4px;">
        ZAF will not touch files inside the imported repo. CLAUDE.md / AGENTS.md presence is detected and surfaced; nothing is written.
      </div>`;
    footer.innerHTML = `
      <button class="zaf-btn secondary" id="nr-back">← Back</button>
      <button class="zaf-btn" id="nr-import">Import</button>`;
    footer.querySelector('#nr-back').addEventListener('click', renderStep0);
    body.querySelectorAll('input[name="nr-imp-mode"]').forEach(r => r.addEventListener('change', () => {
      form.importMode = body.querySelector('input[name="nr-imp-mode"]:checked').value;
      renderImportStep();
    }));
    const nameI = body.querySelector('#nr-imp-name');
    const cloneI = body.querySelector('#nr-imp-cloneto');
    nameI.addEventListener('input', () => {
      form.name = nameI.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (cloneI && (!form.cloneTo || form.cloneTo.endsWith('/' + form._prevImpName))) {
        cloneI.value = form.name ? `C:/Users/LENOVO/Workspace/01_Repos/${form.name}` : '';
        form.cloneTo = cloneI.value;
      }
      form._prevImpName = form.name;
    });
    footer.querySelector('#nr-import').addEventListener('click', async () => {
      form.name        = body.querySelector('#nr-imp-name').value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      form.displayName = body.querySelector('#nr-imp-display').value.trim();
      form.localPath   = body.querySelector('#nr-imp-path')?.value.trim() || '';
      form.remoteUrl   = body.querySelector('#nr-imp-remote')?.value.trim() || '';
      form.cloneTo     = body.querySelector('#nr-imp-cloneto')?.value.trim() || '';
      if (!form.name) return alert('Repo id is required');
      const btn = footer.querySelector('#nr-import');
      btn.disabled = true; btn.textContent = 'Importing…';
      try {
        const r = await fetch('/api/repo/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name, displayName: form.displayName || form.name,
            mode: form.importMode, localPath: form.localPath,
            remoteUrl: form.remoteUrl, cloneTo: form.cloneTo,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Import failed');
        close();
        await loadData();
        alert(`Imported repo "${form.name}".\nPath: ${data.path}\nCLAUDE.md: ${data.claudeMd ? 'yes' : 'no'} · AGENTS.md: ${data.agentsMd ? 'yes' : 'no'}`);
      } catch (err) {
        alert('Import failed: ' + err.message);
        btn.disabled = false; btn.textContent = 'Import';
      }
    });
  }

  function renderStep1() {
    body.innerHTML = `
      <div class="wizard-steps">
        <div class="wizard-step active">1 · Repo Info</div>
        <div class="wizard-step">2 · Scaffold</div>
      </div>
      <div class="zaf-field"><label>Repo name (slug)</label>
        <input id="nr-name" placeholder="my-repo" value="${safeHTML(form.name)}" />
      </div>
      <div class="zaf-field"><label>Display name</label>
        <input id="nr-displayname" placeholder="My Project" value="${safeHTML(form.displayName)}" />
      </div>
      <div class="zaf-field"><label>Local path</label>
        <input id="nr-path" placeholder="Path will be set after you enter the name" value="${safeHTML(form.localPath)}" />
      </div>
      <div class="zaf-field"><label>Description</label>
        <input id="nr-desc" placeholder="One-line description" value="${safeHTML(form.description)}" />
      </div>
      <div class="zaf-field"><label>GitHub remote URL (optional)</label>
        <input id="nr-remote" placeholder="https://github.com/org/repo.git" value="${safeHTML(form.remoteUrl)}" />
      </div>
      <div class="zaf-field"><label>Scaffold mode</label>
        <div class="scaffold-mode-toggle">
          <label><input type="radio" name="nr-mode" value="manual" ${form.mode==='manual'?'checked':''}><span>Manual</span></label>
          <label><input type="radio" name="nr-mode" value="cli-scaffold" ${form.mode==='cli-scaffold'?'checked':''}><span>Let an agent scaffold this</span></label>
        </div>
      </div>`;
    footer.innerHTML = `
      <button class="zaf-btn secondary" id="nr-back0">← Back</button>
      <button class="zaf-btn" id="nr-step1-next">Next →</button>`;
    footer.querySelector('#nr-back0').addEventListener('click', renderStep0);

    // Auto-fill path from name
    const nameInput = body.querySelector('#nr-name');
    const pathInput = body.querySelector('#nr-path');
    nameInput.addEventListener('input', () => {
      form.name = nameInput.value;
      if (!form.localPath || form.localPath.endsWith('/' + form._prevName)) {
        pathInput.value = form.name ? `C:/Users/LENOVO/Workspace/01_Repos/${form.name}` : '';
        form.localPath = pathInput.value;
      }
      form._prevName = form.name;
    });
    pathInput.addEventListener('input', () => { form.localPath = pathInput.value; });

    footer.querySelector('#nr-step1-next').addEventListener('click', () => {
      form.name        = body.querySelector('#nr-name').value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      form.displayName = body.querySelector('#nr-displayname').value.trim();
      form.localPath   = body.querySelector('#nr-path').value.trim();
      form.description = body.querySelector('#nr-desc').value.trim();
      form.remoteUrl   = body.querySelector('#nr-remote').value.trim();
      form.mode        = body.querySelector('input[name="nr-mode"]:checked')?.value || 'manual';
      if (!form.name)      { alert('Repo name is required'); return; }
      if (!form.localPath) { alert('Local path is required'); return; }
      renderStep2();
    });
  }

  function renderStep2() {
    body.innerHTML = `
      <div class="wizard-steps">
        <div class="wizard-step done">1 · Repo Info ✓</div>
        <div class="wizard-step active">2 · Scaffold</div>
      </div>
      ${form.mode === 'manual' ? `
        <div class="zaf-field"><label>Template</label>
          <select id="nr-template">
            <option value="minimal" ${form.templateName==='minimal'?'selected':''}>Minimal (git init + CLAUDE.md stub)</option>
            <option value="zaf-standard" ${form.templateName==='zaf-standard'?'selected':''}>ZAF Standard (CLAUDE.md, CODEX.md, AGENTS.md + WIP/tickets/ structure)</option>
          </select>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">Repo: <strong>${safeHTML(form.name)}</strong> · Path: <code style="font-size:10px">${safeHTML(form.localPath)}</code></div>
      ` : `
        <div class="zaf-field"><label>Agent role</label>
          <select id="nr-agent-role">
            ${agentKeys.map(k => `<option value="${k}" ${k===form.agentRole?'selected':''}>${safeHTML(agents[k].roleName || k)} (${k})</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Harness</label>
          <select id="nr-agent-harness">
            ${harnesses.map(h => `<option value="${h}" ${h===form.agentHarness?'selected':''}>${displayHarness(h)}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Scaffold instructions</label>
          <textarea id="nr-scaffold-instructions" rows="4" placeholder="What should this repo do? The agent will receive this as its scaffolding brief.">${safeHTML(form.scaffoldInstructions)}</textarea>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">Repo: <strong>${safeHTML(form.name)}</strong> · Path: <code style="font-size:10px">${safeHTML(form.localPath)}</code></div>
      `}`;
    footer.innerHTML = `
      <button class="zaf-btn secondary" id="nr-back">← Back</button>
      <button class="zaf-btn" id="nr-create">${form.mode === 'cli-scaffold' ? 'Create & Dispatch Agent' : 'Create Repository'}</button>`;

    footer.querySelector('#nr-back').addEventListener('click', renderStep1);
    footer.querySelector('#nr-create').addEventListener('click', async () => {
      if (form.mode === 'manual') {
        form.templateName = body.querySelector('#nr-template')?.value || 'zaf-standard';
      } else {
        form.agentRole             = body.querySelector('#nr-agent-role')?.value || agentKeys[0];
        form.agentHarness          = body.querySelector('#nr-agent-harness')?.value || 'claude-code';
        form.scaffoldInstructions  = body.querySelector('#nr-scaffold-instructions')?.value || '';
      }

      const btn = footer.querySelector('#nr-create');
      btn.disabled = true;
      btn.textContent = 'Creating…';

      try {
        const r = await fetch('/api/repo/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name:                 form.name,
            displayName:          form.displayName || form.name,
            localPath:            form.localPath,
            description:          form.description,
            remoteUrl:            form.remoteUrl,
            mode:                 form.mode,
            templateName:         form.templateName,
            agentRole:            form.agentRole,
            agentHarness:         form.agentHarness,
            scaffoldInstructions: form.scaffoldInstructions,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Create failed');
        close();
        await loadData();
        if (data.ticketId) {
          openConsolePanel();
          alert(`Repository created.\nScaffold ticket: ${data.ticketId}\nAgent dispatched.`);
        } else {
          alert(`Repository "${form.name}" created at:\n${form.localPath}`);
        }
      } catch (err) {
        alert('Create failed: ' + err.message);
        btn.disabled = false;
        btn.textContent = form.mode === 'cli-scaffold' ? 'Create & Dispatch Agent' : 'Create Repository';
      }
    });
  }

  renderStep0();
}

// =========================================================================
// MULTI-CONSOLE TERMINAL PANEL
// =========================================================================

function initConsoleResize() {
  const handle = document.getElementById('console-resize-handle');
  if (!handle) return;

  let dragging = false, startY = 0, startHeight = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startHeight = document.getElementById('console-panel').offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const newH = Math.max(80, Math.min(window.innerHeight * 0.7, startHeight + (startY - e.clientY)));
    document.documentElement.style.setProperty('--console-height', newH + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const h = document.getElementById('console-panel').offsetHeight;
    localStorage.setItem('zaf-console-height', h);
    localStorage.removeItem('zaf-console-collapsed');
  });

  handle.addEventListener('dblclick', () => {
    const collapsed = localStorage.getItem('zaf-console-collapsed') === 'true';
    if (collapsed) {
      const saved = localStorage.getItem('zaf-console-height') || '260';
      document.documentElement.style.setProperty('--console-height', saved + 'px');
      localStorage.setItem('zaf-console-collapsed', 'false');
    } else {
      const h = document.getElementById('console-panel').offsetHeight;
      localStorage.setItem('zaf-console-height', h);
      document.documentElement.style.setProperty('--console-height', '0px');
      localStorage.setItem('zaf-console-collapsed', 'true');
    }
  });
}

function bindConsolePanel() {
  document.getElementById('console-panel-close')?.addEventListener('click', closeConsolePanel);
  document.getElementById('console-clear-terminated')?.addEventListener('click', async () => {
    await fetch('/api/process/clear');
  });
  document.getElementById('console-kill-active')?.addEventListener('click', async () => {
    if (!STATE.activeProcessTab) return;
    if (!confirm('Kill subshell ' + STATE.activeProcessTab + '?')) return;
    await fetch('/api/process/kill?id=' + encodeURIComponent(STATE.activeProcessTab));
  });

  // ↓ Latest: switch to most recent live process + scroll terminal to bottom
  document.getElementById('console-jump-latest')?.addEventListener('click', () => {
    const live = Array.from(STATE.processes.values())
      .filter(p => isLiveProcess(p.meta))
      .sort((a, b) => (b.meta.startTime || 0) - (a.meta.startTime || 0));
    if (live.length) {
      STATE.activeProcessTab = live[0].meta.processId;
      renderConsoleTabs();
    }
    const term = STATE.terminals.get(STATE.activeProcessTab);
    if (term) try { term.scrollToBottom(); } catch {}
  });

  // < > tab bar scroll arrows
  document.getElementById('console-tabs-prev')?.addEventListener('click', () => {
    const el = document.getElementById('console-tabs');
    if (el) el.scrollBy({ left: -160, behavior: 'smooth' });
  });
  document.getElementById('console-tabs-next')?.addEventListener('click', () => {
    const el = document.getElementById('console-tabs');
    if (el) el.scrollBy({ left: 160, behavior: 'smooth' });
  });

  // Keyboard nav: Alt+← / Alt+→ cycle; Alt+1-9 jump by index
  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const tabsEl = document.getElementById('console-tabs');
    if (!tabsEl) return;
    const tabs = Array.from(tabsEl.querySelectorAll('.console-tab[data-process-id]'));
    if (!tabs.length) return;

    const currentIdx = tabs.findIndex(t => t.dataset.processId === STATE.activeProcessTab);
    let newIdx = -1;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      newIdx = currentIdx <= 0 ? tabs.length - 1 : currentIdx - 1;
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      newIdx = currentIdx >= tabs.length - 1 ? 0 : currentIdx + 1;
    } else if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < tabs.length) { e.preventDefault(); newIdx = idx; }
    }

    if (newIdx >= 0) {
      STATE.activeProcessTab = tabs[newIdx].dataset.processId;
      renderConsoleTabs();
    }
  });
}

function bindTopbarConsoleToggle() {
  document.getElementById('topbar-console-toggle')?.addEventListener('click', () => {
    STATE.consoleOpen ? closeConsolePanel() : openConsolePanel();
  });
}

function openConsolePanel() {
  STATE.consoleOpen = true;
  document.getElementById('console-panel').classList.add('active');
  document.getElementById('console-panel-dot').classList.add('active');
  document.getElementById('console-pulse').classList.add('active');
  const handle = document.getElementById('console-resize-handle');
  if (handle) handle.style.display = 'block';
  const savedHeight = localStorage.getItem('zaf-console-height');
  const collapsed = localStorage.getItem('zaf-console-collapsed') === 'true';
  if (savedHeight && !collapsed) {
    document.documentElement.style.setProperty('--console-height', savedHeight + 'px');
  }
}
function closeConsolePanel() {
  STATE.consoleOpen = false;
  document.getElementById('console-panel').classList.remove('active');
  document.getElementById('console-panel-dot').classList.remove('active');
  document.getElementById('console-pulse').classList.remove('active');
  const handle = document.getElementById('console-resize-handle');
  if (handle) handle.style.display = 'none';
}

function updateShellCounter() {
  const total = STATE.processes.size;
  const running = Array.from(STATE.processes.values()).filter(p => p.meta.status === 'running').length;
  const countEl = document.getElementById('topbar-shell-count');
  const runtimeEl = document.getElementById('runtime-active');
  if (countEl) {
    countEl.textContent = total + (running ? ` (${running})` : '');
    countEl.classList.toggle('running', running > 0);
  }
  if (runtimeEl) runtimeEl.textContent = running;
  const subtitle = document.getElementById('console-panel-subtitle');
  if (subtitle) {
    if (!total) subtitle.textContent = '— No active subshells';
    else subtitle.textContent = `— ${running} running · ${total - running} terminated`;
  }
}

function onProcessStart(meta) {
  if (!STATE.processes.has(meta.processId)) {
    STATE.processes.set(meta.processId, { meta, lines: [] });
  } else {
    STATE.processes.get(meta.processId).meta = meta;
  }
  // CLI Hub inline PTYs don't touch Multi-Console
  if (meta.kind === 'cli-hub') return;
  STATE.activeProcessTab = meta.processId;
  openConsolePanel();
  renderConsoleTabs();
  updateShellCounter();
}

function onProcessLog(msg) {
  const entry = STATE.processes.get(msg.processId);
  if (!entry) return;
  entry.lines.push({ line: msg.line, kind: msg.kind, ts: msg.ts });
  if (entry.lines.length > 8000) entry.lines.splice(0, entry.lines.length - 8000);
  if (STATE.activeProcessTab === msg.processId) {
    appendActiveTabLine(msg);
  }
}

function onProcessEnd(meta) {
  const entry = STATE.processes.get(meta.processId);
  if (entry) entry.meta = meta;
  // Clear countdown if still running
  if (STATE.prefireCountdowns.has(meta.processId)) {
    clearInterval(STATE.prefireCountdowns.get(meta.processId));
    STATE.prefireCountdowns.delete(meta.processId);
  }
  // Handle CLI Hub inline PTY endings (TKT-ZAF-0019)
  const cliHubInfo = STATE.cliHubProcesses.get(meta.processId);
  if (cliHubInfo) {
    STATE.cliHubProcesses.delete(meta.processId);
    const { harnessId, kind } = cliHubInfo;
    if (kind === 'install') {
      const btn = document.getElementById(`cli-install-btn-${harnessId}`);
      if (btn) { btn.disabled = false; btn.textContent = 'Install'; }
      if (meta.exitCode === 0) {
        fetch(`/api/cli/status?harness=${encodeURIComponent(harnessId)}`)
          .then(r => r.json())
          .then(data => {
            STATE.cliHubStatus[harnessId] = data;
            const badge = document.getElementById(`cli-badge-install-${harnessId}`);
            if (badge) {
              badge.textContent = data.installed ? `✓ ${data.version || 'Installed'}` : '✗ Not installed';
              badge.className = `cli-status-badge ${data.installed ? 'installed' : 'not-installed'}`;
            }
          }).catch(() => {});
      }
    } else if (kind === 'connect') {
      const btn = document.getElementById(`cli-connect-btn-${harnessId}`);
      if (btn) { btn.disabled = false; btn.textContent = 'Connect / Auth'; }
      if (meta.exitCode === 0) {
        const ts = new Date().toLocaleTimeString();
        STATE.cliHubConnected[harnessId] = ts;
        const authBadge = document.getElementById(`cli-badge-auth-${harnessId}`);
        if (authBadge) { authBadge.textContent = `Connected ✓ ${ts}`; authBadge.className = 'cli-status-badge auth-connected'; }
        fetch(`/api/cli/status?harness=${encodeURIComponent(harnessId)}`)
          .then(r => r.json())
          .then(data => {
            STATE.cliHubStatus[harnessId] = data;
            const badge = document.getElementById(`cli-badge-install-${harnessId}`);
            if (badge) {
              badge.textContent = data.installed ? `✓ ${data.version || 'Installed'}` : '✗ Not installed';
              badge.className = `cli-status-badge ${data.installed ? 'installed' : 'not-installed'}`;
            }
          }).catch(() => {});
      }
    }
    return; // Don't update console tabs for CLI Hub processes
  }
  renderConsoleTabs();
  updateShellCounter();
}

// PTY byte chunk received — write to xterm.js terminal (with dedup by ts, TKT-ZAF-0023)
function onProcessPty(processId, base64Data, ts) {
  const term = STATE.terminals.get(processId);
  if (ts !== undefined) {
    const lastTs = STATE.terminalLastTs.get(processId) || 0;
    if (ts <= lastTs) return;
    STATE.terminalLastTs.set(processId, ts);
  }
  try {
    const binary = atob(base64Data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    if (term) term.write(arr);
    // Feed agent text buffer (TKT-ZAF-0021)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(arr);
    const prev = STATE.agentTextBuffers.get(processId) || '';
    STATE.agentTextBuffers.set(processId, prev + stripAnsi(text));
    if (STATE.agentViewActive.get(processId)) feedAgentViewLive(processId);
  } catch {}
}

// 10-second pre-fire countdown started
function onProcessPrefire(processId, prefireDeadline) {
  const deadline = new Date(prefireDeadline).getTime();
  const badgeId = `prefire-badge-${processId}`;
  const tick = () => {
    const el = document.getElementById(badgeId);
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (el) el.textContent = remaining > 0 ? `⏱ ${remaining}s pre-fire` : '⚡ Seeding…';
    if (remaining <= 0) {
      clearInterval(STATE.prefireCountdowns.get(processId));
      STATE.prefireCountdowns.delete(processId);
    }
  };
  const iv = setInterval(tick, 500);
  STATE.prefireCountdowns.set(processId, iv);
  tick();
}

// Seed was injected — update badge
function onProcessSeeded(processId) {
  const badge = document.getElementById(`prefire-badge-${processId}`);
  if (badge) { badge.textContent = '✓ Seeded · running'; badge.style.color = '#10b981'; }
  clearInterval(STATE.prefireCountdowns.get(processId));
  STATE.prefireCountdowns.delete(processId);
}

// Operator paused pre-fire
function onProcessPrefirePaused(processId) {
  clearInterval(STATE.prefireCountdowns.get(processId));
  STATE.prefireCountdowns.delete(processId);
  const badge = document.getElementById(`prefire-badge-${processId}`);
  if (badge) { badge.textContent = '⏸ Pre-fire paused'; badge.style.color = '#f59e0b'; }
}


function isLiveProcess(meta) {
  return meta.status === 'running' || meta.status === 'pre-fire' || meta.status === 'pre-fire-paused';
}
function isCompletedProcess(meta) {
  return meta.status === 'completed';
}
function isFailedProcess(meta) {
  return !isLiveProcess(meta) && !isCompletedProcess(meta);
}

function renderConsoleTabs() {
  const tabsEl = document.getElementById('console-tabs');
  const bodiesEl = document.getElementById('console-bodies');
  const emptyEl = document.getElementById('console-empty');
  if (!tabsEl) return;

  const allProcs = Array.from(STATE.processes.values()).filter(p => p.meta.kind !== 'cli-hub');
  if (!allProcs.length) {
    tabsEl.innerHTML = '';
    bodiesEl.querySelectorAll('.console-body').forEach(b => b.remove());
    if (emptyEl) emptyEl.style.display = 'flex';
    STATE.activeProcessTab = null;
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Group by Live / Completed / Failed — newest first within each group
  const byTime = (a, b) => (b.meta.startTime || 0) - (a.meta.startTime || 0);
  const live      = allProcs.filter(p => isLiveProcess(p.meta)).sort(byTime);
  const completed = allProcs.filter(p => isCompletedProcess(p.meta)).sort(byTime);
  const failed    = allProcs.filter(p => isFailedProcess(p.meta)).sort(byTime);
  const procs = [...live, ...completed, ...failed];

  if (!procs.find(p => p.meta.processId === STATE.activeProcessTab)) {
    STATE.activeProcessTab = (live[0] || procs[0]).meta.processId;
  }

  function makeTabHtml({ meta }) {
    const statusClass = isLiveProcess(meta) ? 'running' :
                       meta.status === 'completed' ? 'completed' :
                       meta.status === 'killed' ? 'killed' :
                       meta.status === 'external' ? 'external' : 'failed';
    const dur = meta.durationSec != null ? `${meta.durationSec.toFixed(1)}s`
              : `${((Date.now() - meta.startTime)/1000).toFixed(0)}s+`;
    const isActive = STATE.activeProcessTab === meta.processId;
    const prefireId = `prefire-badge-${meta.processId}`;
    const loopFlag = (STATE.processLoopFlags || {})[meta.processId];
    return `
      <div class="console-tab ${isActive?'active':''}" data-process-id="${meta.processId}">
        <span class="tab-status-dot ${statusClass}"></span>
        <span class="tab-id">${meta.processId}</span>
        <span class="tab-meta">${meta.role} · ${meta.ticketId}</span>
        <span class="tab-meta">${dur}</span>
        ${meta.status === 'pre-fire' || meta.status === 'pre-fire-paused' ? `<span id="${prefireId}" class="tab-meta" style="color:#f59e0b">⏱ pre-fire</span>` : ''}
        ${loopFlag ? `<span class="tab-loop-badge" title="${safeHTML(loopFlag.msg)}">⟳ loop</span>` : ''}
        <span class="tab-close" data-close="${meta.processId}" title="Remove from tabs">✕</span>
      </div>`;
  }

  const parts = [];
  if (live.length)      parts.push(...live.map(makeTabHtml));
  if (live.length && (completed.length || failed.length)) parts.push('<div class="console-tab-divider"></div>');
  if (completed.length) parts.push(...completed.map(makeTabHtml));
  if (completed.length && failed.length) parts.push('<div class="console-tab-divider"></div>');
  if (failed.length)    parts.push(...failed.map(makeTabHtml));
  tabsEl.innerHTML = parts.join('');

  // Body containers — xterm.js based (TKT-ZAF-0013)
  const existingBodies = new Set(Array.from(bodiesEl.querySelectorAll('.console-body')).map(b => b.dataset.processId));
  for (const { meta } of procs) {
    let body = bodiesEl.querySelector(`.console-body[data-process-id="${meta.processId}"]`);
    const isRunning = meta.status === 'running' || meta.status === 'pre-fire' || meta.status === 'pre-fire-paused';
    if (!body) {
      body = document.createElement('div');
      body.className = 'console-body';
      body.dataset.processId = meta.processId;
      body.innerHTML = `
        <div class="console-body-meta">
          <span>Process<strong> ${meta.processId}</strong></span>
          <span>PID<strong> ${meta.pid || '—'}</strong></span>
          <span>Ticket<strong> ${meta.ticketId}</strong></span>
          <span>Role<strong> ${meta.role}</strong></span>
          <span>Harness<strong title="${meta.harness === 'mock' ? 'Test-only harness. Produces synthetic agent output to validate the ZAF pipeline without consuming AI credits. Not a real AI.' : ''}"> ${displayHarness(meta.harness)}</strong></span>
          <span>Model<strong> ${meta.model || 'default'}</strong></span>
          <span>Heartbeat<strong> ${meta.heartbeat || '—'}s</strong></span>
          <span class="console-body-status">Status<strong> ${meta.status}</strong></span>
        </div>
        <div class="console-view-toggle">
          <button class="view-toggle-btn active" data-view="terminal" data-pid="${meta.processId}">Terminal</button>
          <button class="view-toggle-btn" data-view="agent" data-pid="${meta.processId}">Agent</button>
        </div>
        <div class="xterm-host" id="xterm-host-${meta.processId}" style="height:320px;background:#0a0a0f;"></div>
        <div class="agent-view" id="agent-view-${meta.processId}" style="display:none;"></div>
        <div class="steer-row" data-steer-for="${meta.processId}" style="display:flex;gap:6px;padding:6px;border-top:1px solid #1a1a20;align-items:center;">
          <input type="text" class="steer-input" placeholder="Send input to agent…" style="flex:1;background:#111118;color:#e0e0e8;border:1px solid #2a2a35;border-radius:4px;padding:5px 8px;font-family:monospace;font-size:12px;" />
          <button class="steer-send zaf-btn secondary" style="padding:5px 10px;font-size:11px;" data-steer-pid="${meta.processId}">Send</button>
          <button class="steer-ctrlc zaf-btn" style="padding:5px 8px;font-size:11px;background:#7c3aed;" title="Send Ctrl+C" data-int-pid="${meta.processId}">⌃C</button>
          <button class="steer-terminate zaf-btn" style="padding:5px 8px;font-size:11px;background:#dc2626;" title="Terminate + log" data-term-pid="${meta.processId}">Terminate</button>
          <label style="font-size:11px;color:#666;display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" class="pause-prefire-chk" data-pause-pid="${meta.processId}" ${meta.status==='pre-fire-paused'?'checked':''} />Pause pre-fire
          </label>
        </div>
        <div class="skill-extract-row" data-skill-for="${meta.processId}" style="display:none;padding:6px 8px;border-top:1px solid #1a1a20;">
          <button class="console-btn skill-extract-btn" data-pid="${meta.processId}" data-repo="${meta.repoId || ''}">⊕ Extract skill from this run</button>
          <div class="skill-extract-panel" id="skill-panel-${meta.processId}" style="display:none;margin-top:8px"></div>
        </div>`;
      bodiesEl.appendChild(body);
      // Initialize xterm.js terminal
      initXterm(meta.processId, body);
    } else {
      body.querySelector('.console-body-status')?.replaceChildren(...statusFragment(meta));
    }
    existingBodies.delete(meta.processId);
    body.classList.toggle('active', STATE.activeProcessTab === meta.processId);
    // Show/hide steer row based on status
    const steerRow = body.querySelector('.steer-row');
    if (steerRow) steerRow.style.display = isRunning ? 'flex' : 'none';
    // Show skill extract row for completed processes (TKT-ZAF-0036)
    const skillRow = body.querySelector('.skill-extract-row');
    if (skillRow) skillRow.style.display = meta.status === 'completed' ? 'block' : 'none';
    // Loop warning callout (TKT-ZAF-0035)
    const loopFlag = (STATE.processLoopFlags || {})[meta.processId];
    let loopCallout = body.querySelector('.loop-warning-callout');
    if (loopFlag && !loopCallout) {
      loopCallout = document.createElement('div');
      loopCallout.className = 'loop-warning-callout';
      loopCallout.innerHTML = `<span class="loop-warning-icon">⟳</span><span>${safeHTML(loopFlag.msg)}</span><span style="color:#f59e0b;margin-left:auto;font-size:11px">Consider killing or steering this process.</span>`;
      body.insertBefore(loopCallout, body.querySelector('.xterm-host') || body.firstChild);
    }
  }
  for (const stale of existingBodies) {
    bodiesEl.querySelector(`.console-body[data-process-id="${stale}"]`)?.remove();
  }

  // Auto-scroll active tab into view
  const activeTabEl = tabsEl.querySelector('.console-tab.active');
  if (activeTabEl) activeTabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  tabsEl.querySelectorAll('.console-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      STATE.activeProcessTab = tab.dataset.processId;
      renderConsoleTabs();
    });
  });
  tabsEl.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.close;
      const entry = STATE.processes.get(id);
      if (entry && entry.meta.status === 'running') {
        if (!confirm('This shell is still running. Kill and remove?')) return;
        fetch('/api/process/kill?id=' + encodeURIComponent(id));
      }
      STATE.processes.delete(id);
      if (STATE.activeProcessTab === id) STATE.activeProcessTab = null;
      renderConsoleTabs();
      updateShellCounter();
    });
  });

  // Steering buttons (TKT-ZAF-0014)
  bodiesEl.querySelectorAll('.steer-send').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.steerPid;
      const input = bodiesEl.querySelector(`.steer-row[data-steer-for="${pid}"] .steer-input`);
      if (!input || !input.value.trim()) return;
      const text = input.value + '\r\n';
      fetch(`/api/process/${encodeURIComponent(pid)}/steer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      input.value = '';
    };
  });
  bodiesEl.querySelectorAll('.steer-input').forEach(inp => {
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.nextElementSibling && inp.nextElementSibling.click(); } };
  });
  bodiesEl.querySelectorAll('.steer-ctrlc').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.intPid;
      fetch(`/api/process/${encodeURIComponent(pid)}/interrupt`, { method: 'POST' });
    };
  });
  bodiesEl.querySelectorAll('.steer-terminate').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.termPid;
      if (!confirm('Terminate this agent and write TERMINATED to its Handoff Log?')) return;
      fetch(`/api/process/${encodeURIComponent(pid)}/terminate`, { method: 'POST' });
    };
  });
  bodiesEl.querySelectorAll('.pause-prefire-chk').forEach(chk => {
    chk.onchange = () => {
      const pid = chk.dataset.pausePid;
      if (chk.checked) {
        fetch(`/api/process/${encodeURIComponent(pid)}/pause-prefire`, { method: 'POST' });
      }
    };
  });

  // Skill extract buttons (TKT-ZAF-0036)
  bodiesEl.querySelectorAll('.skill-extract-btn').forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const repoId = btn.dataset.repo;
      const panel = document.getElementById(`skill-panel-${pid}`);
      if (!panel) return;
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
      btn.disabled = true;
      btn.textContent = 'Analysing…';
      panel.style.display = 'block';
      panel.innerHTML = `<div style="color:var(--text-muted);font-size:12px">Scanning event sequence…</div>`;
      try {
        const r = await fetch(`/api/process/skills?id=${encodeURIComponent(pid)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed');
        if (!d.candidates.length) {
          panel.innerHTML = `<div style="color:var(--text-secondary);font-size:12px">No repeating workflow pattern detected in this run (${d.eventCount} events analysed).</div>`;
          return;
        }
        let html = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${d.candidates.length} skill candidate${d.candidates.length !== 1 ? 's' : ''} found (${d.eventCount} events)</div>`;
        for (const c of d.candidates) {
          const cid = `skill-cand-${pid}-${c.name}`;
          html += `<div class="skill-candidate-card" id="${cid}">
            <div class="skill-cand-header">
              <span class="skill-cand-name">${safeHTML(c.name)}</span>
              <span class="skill-cand-meta">${c.occurrences}× · ${c.steps.length} steps</span>
            </div>
            <div class="skill-cand-desc">${safeHTML(c.description)}</div>
            ${c.tools.length ? `<div class="skill-cand-tools">${c.tools.map(t => `<span class="skill-tool-tag">${safeHTML(t)}</span>`).join('')}</div>` : ''}
            <div class="skill-cand-steps">${c.steps.map(s => `<div>${safeHTML(s)}</div>`).join('')}</div>
            <div class="skill-cand-actions">
              <button class="console-btn skill-save-btn" data-cid="${safeHTML(cid)}" data-pid="${safeHTML(pid)}" data-repo="${safeHTML(repoId)}" data-name="${safeHTML(c.name)}" data-desc="${safeHTML(c.description)}" data-steps="${safeHTML(JSON.stringify(c.steps))}" data-tools="${safeHTML(JSON.stringify(c.tools))}">Save as .zaf-skill.md</button>
              <button class="console-btn skill-dismiss-btn" data-cid="${safeHTML(cid)}">Dismiss</button>
            </div>
          </div>`;
        }
        panel.innerHTML = html;
        // Wire save/dismiss
        panel.querySelectorAll('.skill-save-btn').forEach(sb => {
          sb.onclick = async () => {
            sb.disabled = true;
            sb.textContent = 'Saving…';
            try {
              const proc = STATE.processes.get(sb.dataset.pid);
              const sr = await fetch('/api/skill/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: sb.dataset.name,
                  description: sb.dataset.desc,
                  steps: JSON.parse(sb.dataset.steps),
                  tools: JSON.parse(sb.dataset.tools),
                  sourceProcess: sb.dataset.pid,
                  sourceTicket: proc?.meta?.ticketId || '',
                  repoName: sb.dataset.repo,
                }),
              });
              const sd = await sr.json();
              if (!sr.ok) throw new Error(sd.error || 'Save failed');
              sb.textContent = `✓ Saved: ${sd.path}`;
              sb.style.color = 'var(--status-done, #10b981)';
            } catch (e) {
              sb.textContent = 'Error: ' + e.message;
              sb.disabled = false;
            }
          };
        });
        panel.querySelectorAll('.skill-dismiss-btn').forEach(db => {
          db.onclick = () => {
            const card = document.getElementById(db.dataset.cid);
            if (card) card.remove();
            if (!panel.querySelector('.skill-candidate-card')) panel.innerHTML = '<div style="color:var(--text-muted);font-size:12px">All candidates dismissed.</div>';
          };
        });
      } catch (e) {
        panel.innerHTML = `<div style="color:var(--status-blocked);font-size:12px">Error: ${safeHTML(e.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = '⊕ Extract skill from this run';
      }
    };
  });

  // Terminal / Agent view toggle (TKT-ZAF-0021)
  bodiesEl.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.pid;
      const view = btn.dataset.view;
      const body = bodiesEl.querySelector(`.console-body[data-process-id="${pid}"]`);
      if (!body) return;
      const xtermHost = body.querySelector(`#xterm-host-${pid}`);
      const agentViewEl = body.querySelector(`#agent-view-${pid}`);
      body.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (view === 'terminal') {
        if (xtermHost) xtermHost.style.display = '';
        if (agentViewEl) agentViewEl.style.display = 'none';
        STATE.agentViewActive.set(pid, false);
      } else {
        if (xtermHost) xtermHost.style.display = 'none';
        if (agentViewEl) { agentViewEl.style.display = ''; initAgentView(pid, agentViewEl); }
        STATE.agentViewActive.set(pid, true);
      }
    };
  });
}

// Initialize xterm.js terminal for a process (TKT-ZAF-0013)
function initXterm(processId, bodyEl) {
  if (!window.Terminal || STATE.terminals.has(processId)) return;
  const hostEl = bodyEl.querySelector(`#xterm-host-${processId}`);
  if (!hostEl) return;

  const sidecarUrl = window._zafSidecarUrl || 'http://localhost:4242';

  const term = new Terminal({
    convertEol: true,
    fontSize: 12,
    fontFamily: 'monospace',
    theme: {
      background: '#0a0a0f',
      foreground: '#c8c8d4',
      cursor: '#10b981',
      selectionBackground: '#2d3748',
    },
    cursorBlink: true,
    scrollback: 5000,
    cols: 180,
    rows: 24,
  });

  const fitAddon = window.FitAddon ? new FitAddon.FitAddon() : null;
  if (fitAddon) term.loadAddon(fitAddon);

  term.open(hostEl);
  if (fitAddon) { try { fitAddon.fit(); } catch {} }
  STATE.terminals.set(processId, term);

  // Keystrokes in terminal → POST to /api/process/<id>/steer (bidirectional TKT-ZAF-0014)
  term.onData((data) => {
    const base64 = btoa(unescape(encodeURIComponent(data)));
    fetch(`${sidecarUrl}/api/process/${encodeURIComponent(processId)}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    }).catch(() => {});
  });

  // Load PTY buffer (replay missed chunks, skip already-rendered by ts, TKT-ZAF-0023)
  fetch(`${sidecarUrl}/api/process/buffer?id=${encodeURIComponent(processId)}`)
    .then(r => r.json())
    .then(({ buffer }) => {
      if (Array.isArray(buffer)) {
        let highestTs = STATE.terminalLastTs.get(processId) || 0;
        for (const chunk of buffer) {
          if (chunk.ts !== undefined && chunk.ts <= highestTs) continue;
          if (chunk.data) {
            try {
              const bin = atob(chunk.data);
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              term.write(arr);
            } catch {}
          }
          if (chunk.ts !== undefined && chunk.ts > highestTs) highestTs = chunk.ts;
        }
        STATE.terminalLastTs.set(processId, highestTs);
      }
    })
    .catch(() => {});
}

function statusFragment(meta) {
  const span = document.createElement('span');
  span.textContent = 'Status';
  const strong = document.createElement('strong');
  strong.textContent = ' ' + meta.status;
  return [span, strong];
}

// Initialize xterm.js terminal in an arbitrary host element (CLI Hub inline PTY — TKT-ZAF-0019)
function initXtermInElement(processId, hostEl) {
  if (!window.Terminal || STATE.terminals.has(processId)) return;
  const sidecarUrl = window._zafSidecarUrl || 'http://localhost:4242';
  const term = new Terminal({
    convertEol: true, fontSize: 12, fontFamily: 'monospace',
    theme: { background: '#0a0a0f', foreground: '#c8c8d4', cursor: '#10b981', selectionBackground: '#2d3748' },
    cursorBlink: true, scrollback: 2000, cols: 120, rows: 14,
  });
  const fitAddon = window.FitAddon ? new FitAddon.FitAddon() : null;
  if (fitAddon) term.loadAddon(fitAddon);
  term.open(hostEl);
  if (fitAddon) { try { fitAddon.fit(); } catch {} }
  STATE.terminals.set(processId, term);
  term.onData((data) => {
    const base64 = btoa(unescape(encodeURIComponent(data)));
    fetch(`${sidecarUrl}/api/process/${encodeURIComponent(processId)}/steer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    }).catch(() => {});
  });
  fetch(`${sidecarUrl}/api/process/buffer?id=${encodeURIComponent(processId)}`)
    .then(r => r.json())
    .then(({ buffer }) => {
      if (!Array.isArray(buffer)) return;
      let highestTs = STATE.terminalLastTs.get(processId) || 0;
      for (const chunk of buffer) {
        if (chunk.ts !== undefined && chunk.ts <= highestTs) continue;
        if (chunk.data) {
          try {
            const bin = atob(chunk.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            term.write(arr);
          } catch {}
        }
        if (chunk.ts !== undefined && chunk.ts > highestTs) highestTs = chunk.ts;
      }
      STATE.terminalLastTs.set(processId, highestTs);
    }).catch(() => {});
}

function appendLineToLogs(logsEl, entry) {
  const line = document.createElement('div');
  line.className = 'console-line ' + (entry.kind || 'stdout');
  const ts = new Date(entry.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  line.innerHTML = `<span class="ts">${ts}</span>${safeHTML(entry.line)}`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function appendActiveTabLine(msg) {
  const logsEl = document.querySelector(`.console-body-logs[data-logs-for="${msg.processId}"]`);
  if (!logsEl) return;
  appendLineToLogs(logsEl, msg);
}

// =========================================================================
// AGENT VIEW — STREAM PARSER + HTML RENDERER (TKT-ZAF-0021)
// =========================================================================

function stripAnsi(str) {
  return str
    .replace(/\x1B\][^\x07\x1B]*\x07/g, '')        // OSC + BEL terminator (window title etc.)
    .replace(/\x1B\][^\x1B]*\x1B\\/g, '')           // OSC + ST terminator
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, ''); // CSI and single-char escapes
}

// Harness-isolated parser map. Each entry: { isStub: bool, parse(lines) -> events[] }
const HARNESS_PARSERS = {
  'mock': {
    isStub: false,
    parse(lines) {
      const events = [];
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        if (/^\[TOOL CALL\]/i.test(l)) {
          const args = l.replace(/^\[TOOL CALL\]\s*/i, '');
          const name = args.split(/\s+/)[0] || 'Tool';
          events.push({ type: 'tool.start', name, args });
        } else if (/^\[API REQUEST\]/i.test(l)) {
          events.push({ type: 'tool.start', name: 'API', args: l.replace(/^\[API REQUEST\]\s*/i, '') });
        } else if (/^\[DECISION\]/i.test(l)) {
          events.push({ type: 'thinking', content: l.replace(/^\[DECISION\]\s*/i, '') });
        } else if (/^✓|^done\b/i.test(l)) {
          events.push({ type: 'tool.end', name: 'command', durationMs: null, ok: true });
        } else if (/^✗|^error\b/i.test(l)) {
          events.push({ type: 'tool.end', name: 'command', durationMs: null, ok: false });
        } else {
          events.push({ type: 'response', content: l });
        }
      }
      return events;
    },
  },

  'claude-code': {
    isStub: false,
    parse(lines) {
      const events = [];
      let inToolOutput = false;
      let currentTool = null;
      let toolOutputLines = [];

      const flushToolOutput = () => {
        if (toolOutputLines.length) {
          events.push({ type: 'tool.output', content: toolOutputLines.join('\n') });
          toolOutputLines = [];
        }
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const l = line.trim();
        if (!l) continue;

        // tool.start: ◆ or ● prefix
        if (/^[◆●]\s+(Bash|Read|Write|Edit|Glob|Grep|WebFetch|Task|TodoWrite|WebSearch|Agent|mcp\S*)/i.test(l)) {
          flushToolOutput();
          const m = l.match(/^[◆●]\s+(\S+)\s*(.*)/);
          currentTool = m ? m[1] : 'Tool';
          events.push({ type: 'tool.start', name: currentTool, args: m ? m[2] : '' });
          inToolOutput = true;
          continue;
        }

        // tool.end: ✓ or ✗
        if (/^[✓✗]\s+\w/.test(l)) {
          flushToolOutput();
          const ok = l.startsWith('✓');
          const durMatch = l.match(/\((\d+(?:\.\d+)?)s\)/);
          const durationMs = durMatch ? Math.round(parseFloat(durMatch[1]) * 1000) : null;
          const name = l.replace(/^[✓✗]\s+/, '').split(/[\s(]/)[0] || currentTool || 'Tool';
          events.push({ type: 'tool.end', name, durationMs, ok });
          inToolOutput = false;
          currentTool = null;
          continue;
        }

        // thinking delimiters
        if (l === '<thinking>') { inToolOutput = false; continue; }
        if (l === '</thinking>') { continue; }

        // tool output: pipe prefix or 4-space indent while inToolOutput
        if (inToolOutput && (l.startsWith('│') || line.startsWith('    '))) {
          toolOutputLines.push(l.replace(/^│\s?/, ''));
          continue;
        }

        if (inToolOutput) {
          flushToolOutput();
          inToolOutput = false;
        }

        // diff hunk
        if (/^[+-]{3}\s/.test(l) || /^@@.*@@/.test(l)) {
          events.push({ type: 'diff.block', filename: l, before: '', after: l });
          continue;
        }

        events.push({ type: 'response', content: l });
      }
      flushToolOutput();
      return events;
    },
  },

  'codex': {
    isStub: false,
    parse(lines) {
      const events = [];
      let currentTool = null;
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        if (/^>\s*(running|executing):/i.test(l)) {
          const args = l.replace(/^>\s*(running|executing):\s*/i, '');
          currentTool = args.split(/\s+/)[0] || 'command';
          events.push({ type: 'tool.start', name: currentTool, args });
        } else if (/^<\s*(done|error)/i.test(l)) {
          events.push({ type: 'tool.end', name: currentTool || 'command', durationMs: null, ok: /done/i.test(l) });
          currentTool = null;
        } else {
          events.push({ type: 'response', content: l });
        }
      }
      return events;
    },
  },

  'antigravity': {
    isStub: false,
    parse(lines) {
      const events = [];
      let currentTool = null;
      let inThinking = false;
      let toolOutputLines = [];
      const flushOutput = () => {
        if (toolOutputLines.length) {
          events.push({ type: 'tool.output', content: toolOutputLines.join('\n') });
          toolOutputLines = [];
        }
      };
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;

        // Thinking blocks (Gemini-style)
        if (/^<thinking>$/i.test(l)) { inThinking = true; continue; }
        if (/^<\/thinking>$/i.test(l)) { inThinking = false; continue; }
        if (inThinking) { events.push({ type: 'thinking', content: l }); continue; }

        // Tool call: "▶ tool_name" or "[tool_use: tool_name]" or "Tool: name"
        if (/^▶\s+\w/.test(l) || /^\[tool_use:\s*\w/.test(l) || /^Tool:\s+\w/i.test(l)) {
          flushOutput();
          const nameMatch = l.match(/(?:▶\s+|tool_use:\s*|Tool:\s+)(\S+)/i);
          currentTool = nameMatch ? nameMatch[1] : 'tool';
          const args = l.replace(/^(?:▶\s+|.*?tool_use:\s*|Tool:\s+)\S+\s*/, '');
          events.push({ type: 'tool.start', name: currentTool, args: args.slice(0, 120) });
          continue;
        }

        // Tool end: "✓ done" / "✗ error" / "→ result:" / "Result:"
        if (/^[✓✗]\s/.test(l) || /^→\s*(result|done|error)/i.test(l)) {
          flushOutput();
          const ok = /^✓/.test(l) || /done/i.test(l);
          events.push({ type: 'tool.end', name: currentTool || 'tool', durationMs: null, ok });
          currentTool = null;
          continue;
        }

        // Tool output: indented or piped while currentTool active
        if (currentTool && (line.startsWith('  ') || line.startsWith('\t') || l.startsWith('│'))) {
          toolOutputLines.push(l.replace(/^│\s?/, ''));
          continue;
        }

        if (currentTool) { flushOutput(); currentTool = null; }

        // Diff hunk
        if (/^[+-]{3}\s/.test(l) || /^@@.*@@/.test(l)) {
          events.push({ type: 'diff.block', filename: l, before: '', after: l });
          continue;
        }

        events.push({ type: 'response', content: l });
      }
      flushOutput();
      return events;
    },
  },
};

function parseAgentStream(lines, harnessId) {
  const parser = HARNESS_PARSERS[harnessId];
  if (parser) return parser.parse(lines);
  return lines.filter(l => l.trim()).map(l => ({ type: 'response', content: l.trim() }));
}

function appendEventsToAgentView(events, agentViewEl) {
  for (const evt of events) {
    switch (evt.type) {
      case 'tool.start': {
        const card = document.createElement('details');
        card.className = 'av-tool-card';
        card.open = true;
        card.dataset.toolName = evt.name;
        const summary = document.createElement('summary');
        summary.className = 'av-tool-summary';
        summary.innerHTML =
          `<span class="av-tool-badge">${safeHTML(evt.name)}</span>` +
          (evt.args ? `<span class="av-tool-args">${safeHTML(evt.args.slice(0, 100))}</span>` : '');
        card.appendChild(summary);
        const out = document.createElement('div');
        out.className = 'av-tool-output';
        card.appendChild(out);
        card.dataset.openTool = '1';
        agentViewEl.appendChild(card);
        break;
      }
      case 'tool.output': {
        const card = agentViewEl.querySelector('.av-tool-card[data-open-tool]');
        if (card) {
          const out = card.querySelector('.av-tool-output');
          if (out) {
            const pre = document.createElement('pre');
            pre.className = 'av-code';
            pre.textContent = evt.content;
            out.appendChild(pre);
          }
        }
        break;
      }
      case 'tool.end': {
        const card = agentViewEl.querySelector('.av-tool-card[data-open-tool]');
        if (card) {
          const summary = card.querySelector('summary');
          const badge = document.createElement('span');
          badge.className = `av-dur-badge ${evt.ok ? 'ok' : 'fail'}`;
          badge.textContent = `${evt.ok ? '✓' : '✗'}${evt.durationMs !== null && evt.durationMs !== undefined ? ' ' + (evt.durationMs / 1000).toFixed(1) + 's' : ''}`;
          if (summary) summary.appendChild(badge);
          card.open = false;
          delete card.dataset.openTool;
        }
        break;
      }
      case 'thinking': {
        const bq = document.createElement('details');
        bq.className = 'av-thinking-block';
        const sum = document.createElement('summary');
        sum.textContent = '💭 Thinking';
        bq.appendChild(sum);
        const p = document.createElement('p');
        p.className = 'av-thinking-text';
        p.textContent = evt.content;
        bq.appendChild(p);
        agentViewEl.appendChild(bq);
        break;
      }
      case 'response': {
        const last = agentViewEl.lastElementChild;
        if (last && last.classList.contains('av-response')) {
          last.textContent += '\n' + evt.content;
        } else {
          const p = document.createElement('p');
          p.className = 'av-response';
          p.textContent = evt.content;
          agentViewEl.appendChild(p);
        }
        break;
      }
      case 'diff.block': {
        const d = document.createElement('div');
        d.className = 'av-diff-block';
        d.innerHTML = `<div class="av-diff-filename">${safeHTML(evt.filename)}</div>` +
          `<pre class="av-diff-content">${safeHTML(evt.after || evt.before || '')}</pre>`;
        agentViewEl.appendChild(d);
        break;
      }
      case 'header': {
        const h = document.createElement('div');
        h.className = 'av-header';
        h.innerHTML = [
          evt.ticketId ? `<span>🎫 ${safeHTML(evt.ticketId)}</span>` : '',
          evt.role     ? `<span>👤 ${safeHTML(evt.role)}</span>` : '',
          evt.model    ? `<span>🤖 ${safeHTML(evt.model)}</span>` : '',
        ].filter(Boolean).join(' · ');
        agentViewEl.insertBefore(h, agentViewEl.firstChild);
        break;
      }
      case 'system': {
        const d = document.createElement('div');
        d.className = 'av-system';
        d.textContent = evt.content;
        agentViewEl.appendChild(d);
        break;
      }
    }
  }
}

function createTuningCallout(harness, meta) {
  const div = document.createElement('div');
  div.className = 'av-tuning-callout';
  div.innerHTML = `<strong>Parser not tuned for "${safeHTML(harness)}".</strong> Output is shown as raw text below. <button class="av-tuning-btn">Create tuning ticket</button>`;
  div.querySelector('.av-tuning-btn').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/ticket/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Tune structured view parser for ${harness}`,
          description: `## Goal\nCapture 10+ sample runs from the "${harness}" harness, extract output patterns, and update HARNESS_PARSERS in dashboard/app.js.\n\n## Steps\n1. Run the harness on at least 10 varied tickets\n2. Capture raw PTY output (copy from terminal view)\n3. Identify tool.start, tool.end, thinking, response line patterns\n4. Add regex patterns to HARNESS_PARSERS['${harness}'] in dashboard/app.js\n5. Test with real run samples until all event types render correctly`,
          phase: 'P8', workstream: 'WS-UX', priority: 'P3', role: 'engineering', repo: 'zaf',
        }),
      });
      if (r.ok) {
        const data = await r.json();
        alert(`Created tuning ticket: ${data.ticketId}`);
      } else {
        alert('Failed to create ticket: HTTP ' + r.status);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
  return div;
}

async function initAgentView(processId, agentViewEl) {
  const entry = STATE.processes.get(processId);
  if (!entry) return;
  const harness = entry.meta?.harness || 'mock';
  const sidecarUrl = window._zafSidecarUrl || 'http://localhost:4242';
  const t0 = performance.now();

  agentViewEl.innerHTML = '<div class="av-loading">Parsing stream…</div>';

  let textBuf = STATE.agentTextBuffers.get(processId) || '';

  // For completed processes, load full sidecar buffer if not already cached
  if (!isLiveProcess(entry.meta) && !textBuf) {
    try {
      const r = await fetch(`${sidecarUrl}/api/process/buffer?id=${encodeURIComponent(processId)}`);
      const { buffer } = await r.json();
      if (Array.isArray(buffer)) {
        let raw = '';
        for (const chunk of buffer) {
          if (!chunk.data) continue;
          try {
            const bin = atob(chunk.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            raw += new TextDecoder('utf-8', { fatal: false }).decode(arr);
          } catch {}
        }
        textBuf = stripAnsi(raw);
        STATE.agentTextBuffers.set(processId, textBuf);
      }
    } catch {}
  }

  const lines = textBuf.split('\n').filter(l => l.trim());
  agentViewEl.innerHTML = '';

  const parser = HARNESS_PARSERS[harness];
  if (!parser || parser.isStub) {
    agentViewEl.appendChild(createTuningCallout(harness, entry.meta));
  }

  const events = parseAgentStream(lines, harness);
  appendEventsToAgentView(events, agentViewEl);
  STATE.agentLineCursors.set(processId, textBuf.split('\n').length);

  if (!agentViewEl.children.length) {
    agentViewEl.innerHTML = '<div class="av-empty">No structured events detected yet. Run an agent to populate this view.</div>';
  }

  const elapsed = (performance.now() - t0).toFixed(0);
  const note = document.createElement('div');
  note.className = 'av-render-note';
  note.textContent = `Rendered ${events.length} events from ${lines.length} lines in ${elapsed}ms`;
  agentViewEl.appendChild(note);
}

function feedAgentViewLive(processId) {
  if (!STATE.agentViewActive.get(processId)) return;
  const agentViewEl = document.getElementById(`agent-view-${processId}`);
  if (!agentViewEl) return;
  const harness = STATE.processes.get(processId)?.meta?.harness || 'mock';
  const buf = STATE.agentTextBuffers.get(processId) || '';
  const cursor = STATE.agentLineCursors.get(processId) || 0;

  const allLines = buf.split('\n');
  const complete = buf.endsWith('\n') ? allLines : allLines.slice(0, -1);
  if (complete.length <= cursor) return;

  const newLines = complete.slice(cursor).filter(l => l.trim());
  STATE.agentLineCursors.set(processId, complete.length);

  // Remove loading/empty placeholder on first real content
  const placeholder = agentViewEl.querySelector('.av-loading, .av-empty');
  if (placeholder && newLines.length) placeholder.remove();

  const events = parseAgentStream(newLines, harness);
  appendEventsToAgentView(events, agentViewEl);
}

// =========================================================================
// VIEW: AUDIT LOG
// =========================================================================

function renderAudit(container) {
  loadAudit();
  let kindFilter = STATE._auditFilter || '';
  const entries = STATE.audit.slice().reverse();
  const filtered = kindFilter ? entries.filter(e => (e.kind||'').startsWith(kindFilter)) : entries;

  const kindTag = (kind) => {
    const root = (kind||'').split('.')[0];
    return `<span class="zaf-audit-tag ${root}">${kind}</span>`;
  };

  const summary = (e) => {
    if (e.kind === 'process.spawn')        return `spawn <code>${e.processId}</code> ${e.role} via ${e.harness} → ${e.ticketId}`;
    if (e.kind === 'process.end')          return `end <code>${e.processId}</code> exit ${e.exitCode} (${e.durationSec?.toFixed?.(1)}s)`;
    if (e.kind === 'process.kill')         return `killed <code>${e.processId}</code> ${e.ticketId}`;
    if (e.kind === 'process.seeded')       return `seed injected → <code>${e.processId}</code> (${e.seedLength}b)`;
    if (e.kind === 'process.limit_hit')    return `rate-limit hit <code>${e.processId}</code> ${e.harness}: ${safeHTML((e.line||'').slice(0,60))}`;
    if (e.kind === 'process.retry')        return `retry #${e.retryCount} <code>${e.processId}</code> ${e.ticketId}`;
    if (e.kind === 'process.blocked_budget') return `rate-limit blocked <code>${e.processId}</code> ${e.ticketId}`;
    if (e.kind === 'operator.steer')       return `steer → <code>${e.processId}</code>: ${safeHTML((e.summary||'').slice(0,80))}`;
    if (e.kind === 'operator.interrupt')   return `Ctrl+C → <code>${e.processId}</code>`;
    if (e.kind === 'operator.terminate')   return `TERMINATED → <code>${e.processId}</code> ${e.ticketId}`;
    if (e.kind === 'operator.pause_prefire') return `pre-fire paused <code>${e.processId}</code>`;
    if (e.kind === 'agent.tool_call')      return `tool call <code>${e.line?.slice(0, 80)}</code>`;
    if (e.kind === 'agent.api_request')    return `api call <code>${e.line?.slice(0, 80)}</code>`;
    if (e.kind === 'agent.decision')       return `decision <code>${e.line?.slice(0, 80)}</code>`;
    if (e.kind === 'ticket.create')        return `ticket <code>${e.ticketId}</code> "${safeHTML(e.title)}"`;
    if (e.kind === 'config.save')          return `config saved`;
    if (e.kind === 'server.boot')          return `server boot on :${e.port}`;
    return JSON.stringify(e).slice(0, 160);
  };

  const rows = filtered.slice(0, 500).map(e => `
    <div class="zaf-audit-row">
      <div class="audit-ts">${new Date(e.ts).toLocaleString()}</div>
      <div class="audit-kind">${kindTag(e.kind)}</div>
      <div class="audit-body">${summary(e)}</div>
    </div>`).join('');

  const kinds = ['', 'process', 'agent', 'operator', 'config', 'ticket', 'server'];
  const filterButtons = kinds.map(k => `<button class="zaf-btn secondary ${kindFilter===k?'active':''}" data-filter="${k}" style="padding:5px 10px;font-size:10px;text-transform:uppercase;">${k || 'All'}</button>`).join('');

  container.innerHTML = `
    <div class="zaf-audit fade-in">
      <div class="zaf-overview-header" style="padding-bottom:14px">
        <div>
          <div class="zaf-overview-title"><div class="accent-bar"></div>Immutable Audit Log</div>
          <div class="zaf-overview-sub">Append-only ledger of every tool call, API request, planner decision, and lifecycle event across all subshells. Cannot be edited or deleted from the UI.</div>
        </div>
        <div class="zaf-audit-immutable-note">Append-only — ${STATE.audit.length} entries</div>
      </div>
      <div class="zaf-audit-toolbar">
        ${filterButtons}
        <button class="zaf-btn secondary" id="audit-refresh">Refresh</button>
      </div>
      <div>${rows || '<div style="color:var(--text-muted);padding:20px;text-align:center">No audit entries yet.</div>'}</div>
    </div>`;

  container.querySelectorAll('button[data-filter]').forEach(b => b.addEventListener('click', () => {
    STATE._auditFilter = b.dataset.filter;
    renderAudit(container);
  }));
  container.querySelector('#audit-refresh')?.addEventListener('click', async () => { await loadAudit(); renderAudit(container); });
}

// =========================================================================
// VIEW: CODEBASE MAP (TKT-ZAF-0025 — static analysis + file import graph)
// =========================================================================

let _cbCtx = null; // cached context for current repo

async function renderCodebaseMap(container) {
  const repo = STATE.filters.repo || (STATE.data?.repos?.[0]?.id) || 'zaf';
  container.innerHTML = `
    <div class="view-graph fade-in" style="display:flex;flex-direction:column;height:100%;gap:0;">
      <div class="graph-toolbar" style="flex-shrink:0;">
        <span style="font-size:15px;font-weight:700;color:var(--text-primary)">⊛ Codebase Map</span>
        <span style="font-size:11px;color:var(--text-muted)" id="cb-repo-label">repo: ${repo}</span>
        <span style="font-size:11px;color:var(--text-muted)" id="cb-stats">Loading…</span>
        <button class="btn btn-secondary" id="cb-refresh">↺ Re-scan</button>
        <button class="btn" id="cb-generate-md">Generate CODEBASE.md</button>
      </div>
      <div style="display:flex;flex:1;min-height:0;overflow:hidden;">
        <div class="graph-canvas-wrap" id="cb-wrap" style="flex:1;position:relative;">
          <svg id="cb-svg" width="100%" height="100%">
            <defs>
              <marker id="cb-arrow" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
                <polygon points="0 0, 6 2.5, 0 5" fill="rgba(99,102,241,0.6)"/>
              </marker>
            </defs>
            <g id="cb-root"></g>
          </svg>
          <div id="cb-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,11,20,0.7);font-size:13px;color:var(--text-secondary)">Scanning…</div>
        </div>
        <div id="cb-inspector" style="width:260px;flex-shrink:0;background:var(--bg-card);border-left:1px solid var(--border-subtle);padding:14px;overflow-y:auto;font-size:12px;">
          <div style="color:var(--text-muted);font-style:italic;">Click a file node to inspect symbols.</div>
        </div>
      </div>
    </div>`;

  const loadCtx = async () => {
    document.getElementById('cb-loading').style.display = 'flex';
    try {
      const r = await fetch(`/api/repo/context?repo=${encodeURIComponent(repo)}`);
      _cbCtx = await r.json();
      document.getElementById('cb-stats').textContent = `${_cbCtx.fileCount} files · ${_cbCtx.graph.nodes.length} nodes · ${_cbCtx.graph.edges.length} import edges · ${_cbCtx.ms}ms`;
      document.getElementById('cb-generate-md').textContent = _cbCtx.codebaseMdExists ? '↺ Regenerate CODEBASE.md' : 'Generate CODEBASE.md';
      drawCodebaseGraph(_cbCtx.graph.nodes, _cbCtx.graph.edges);
    } catch (e) {
      document.getElementById('cb-stats').textContent = 'Error: ' + e.message;
    }
    document.getElementById('cb-loading').style.display = 'none';
  };

  container.querySelector('#cb-refresh').addEventListener('click', loadCtx);
  container.querySelector('#cb-generate-md').addEventListener('click', async () => {
    const btn = container.querySelector('#cb-generate-md');
    btn.disabled = true; btn.textContent = 'Generating…';
    try {
      const r = await fetch('/api/repo/codebase-md', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      btn.textContent = '✓ CODEBASE.md written';
      if (_cbCtx) _cbCtx.codebaseMdExists = true;
      setTimeout(() => { btn.disabled = false; btn.textContent = '↺ Regenerate CODEBASE.md'; }, 2500);
    } catch (e) {
      btn.textContent = 'Error: ' + e.message;
      btn.disabled = false;
    }
  });

  loadCtx();
}

function drawCodebaseGraph(nodes, edges) {
  const svgEl = document.getElementById('cb-svg');
  const root  = document.getElementById('cb-root');
  if (!svgEl || !root) return;
  if (!nodes.length) { root.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#525970" dominant-baseline="middle">No source files found</text>`; return; }

  const W = svgEl.clientWidth || 800;
  const H = svgEl.clientHeight || 500;
  const NW = 110, NH = 26, MARGIN = 50;

  // Color by top-level directory
  const dirs = [...new Set(nodes.map(n => n.dir))];
  const DIR_COLORS = ['#6366f1','#f472b6','#34d399','#f59e0b','#60a5fa','#fb923c','#a78bfa','#2dd4bf'];
  const dirColor = {};
  dirs.forEach((d, i) => { dirColor[d] = DIR_COLORS[i % DIR_COLORS.length]; });

  // Simple force layout (reuse pattern from drawDraggableGraph)
  const pos = {};
  nodes.forEach((n, i) => {
    const cols = Math.ceil(Math.sqrt(nodes.length * 1.5));
    const row = Math.floor(i / cols), col = i % cols;
    pos[n.id] = { x: MARGIN + col * (NW + 30) + (row % 2 ? 0 : (NW + 30) / 2), y: MARGIN + row * (NH + 40) };
  });
  const vel = {};
  nodes.forEach(n => vel[n.id] = { x: 0, y: 0 });
  const nodeIds = new Set(nodes.map(n => n.id));
  const validEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = pos[b.id].x - pos[a.id].x, dy = pos[b.id].y - pos[a.id].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = 2500 / (d * d);
      vel[a.id].x -= dx / d * f; vel[a.id].y -= dy / d * f;
      vel[b.id].x += dx / d * f; vel[b.id].y += dy / d * f;
    }
    for (const e of validEdges) {
      if (!pos[e.from] || !pos[e.to]) continue;
      const dx = pos[e.to].x - pos[e.from].x, dy = pos[e.to].y - pos[e.from].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 160) * 0.04;
      vel[e.from].x += dx / d * f; vel[e.from].y += dy / d * f;
      vel[e.to].x   -= dx / d * f; vel[e.to].y   -= dy / d * f;
    }
    for (const n of nodes) { vel[n.id].x *= 0.8; vel[n.id].y *= 0.8; pos[n.id].x += vel[n.id].x; pos[n.id].y += vel[n.id].y; }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) { minX = Math.min(minX, pos[n.id].x); minY = Math.min(minY, pos[n.id].y); maxX = Math.max(maxX, pos[n.id].x + NW); maxY = Math.max(maxY, pos[n.id].y + NH); }
  const pad = 40;
  const scale = Math.min((W - pad * 2) / ((maxX - minX) || 1), (H - pad * 2) / ((maxY - minY) || 1), 1.4);
  for (const n of nodes) { pos[n.id].x = pad + (pos[n.id].x - minX) * scale; pos[n.id].y = pad + (pos[n.id].y - minY) * scale; }

  let panX = 0, panY = 0, zoom = 1, isPanning = false, panSX = 0, panSY = 0;
  function apply() { root.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`); }

  const edgesHtml = validEdges.map(e => {
    const a = pos[e.from], b = pos[e.to];
    const x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = (y1 + y2) / 2;
    return `<path data-from="${e.from}" data-to="${e.to}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" stroke="rgba(99,102,241,0.35)" stroke-width="1" fill="none" marker-end="url(#cb-arrow)"/>`;
  }).join('');

  const nodesHtml = nodes.map(n => {
    const p = pos[n.id], c = dirColor[n.dir] || '#6366f1';
    const lbl = n.label.length > 16 ? n.label.slice(0, 14) + '…' : n.label;
    const sz = Math.max(1, Math.min(6, n.size / 1000));
    return `<g class="cb-node" data-id="${n.id}" transform="translate(${p.x},${p.y})" style="cursor:pointer;">
      <rect width="${NW}" height="${NH}" rx="4" fill="${c}18" stroke="${c}" stroke-width="${0.8 + sz * 0.3}"/>
      <text x="6" y="17" font-size="10" fill="${c}" font-family="JetBrains Mono,monospace">${safeHTML(lbl)}</text>
    </g>`;
  }).join('');

  root.innerHTML = edgesHtml + nodesHtml;
  apply();

  // Node click → inspector
  root.querySelectorAll('.cb-node').forEach(el => {
    const id = el.dataset.id;
    let dragging = false, sx = 0, sy = 0, sPX = 0, sPY = 0;
    el.addEventListener('mousedown', e => {
      e.stopPropagation(); dragging = false;
      sx = e.clientX; sy = e.clientY; sPX = pos[id].x; sPY = pos[id].y;
      function mm(ev) {
        if (Math.abs(ev.clientX - sx) > 3 || Math.abs(ev.clientY - sy) > 3) dragging = true;
        pos[id].x = sPX + (ev.clientX - sx) / zoom; pos[id].y = sPY + (ev.clientY - sy) / zoom;
        el.setAttribute('transform', `translate(${pos[id].x},${pos[id].y})`);
        root.querySelectorAll(`path[data-from="${id}"],path[data-to="${id}"]`).forEach(p => {
          const ef = p.dataset.from, et = p.dataset.to;
          if (pos[ef] && pos[et]) {
            const a = pos[ef], b = pos[et], x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = (y1 + y2) / 2;
            p.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
          }
        });
      }
      function mu(ev) { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); if (!dragging) showCbInspector(id); }
      window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    });
  });

  svgEl.addEventListener('mousedown', e => { if (e.target.closest('.cb-node')) return; isPanning = true; panSX = e.clientX - panX; panSY = e.clientY - panY; svgEl.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', e => { if (!isPanning) return; panX = e.clientX - panSX; panY = e.clientY - panSY; apply(); });
  window.addEventListener('mouseup', () => { isPanning = false; svgEl.style.cursor = 'grab'; });
  svgEl.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(0.2, Math.min(4, zoom + e.deltaY * -0.001)); apply(); }, { passive: false });
}

function showCbInspector(fileId) {
  const inspector = document.getElementById('cb-inspector');
  if (!inspector || !_cbCtx) return;
  const node = _cbCtx.graph.nodes.find(n => n.id === fileId);
  if (!node) return;
  const imports = _cbCtx.graph.edges.filter(e => e.from === fileId).map(e => e.to);
  const importedBy = _cbCtx.graph.edges.filter(e => e.to === fileId).map(e => e.from);
  inspector.innerHTML = `
    <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;word-break:break-all;">${safeHTML(node.id)}</div>
    <div style="color:var(--text-muted);margin-bottom:10px;">${(node.size/1024).toFixed(1)} KB · ${node.dir}/</div>
    ${node.symbols.length ? `<div style="margin-bottom:8px;">
      <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Exports / Symbols</div>
      ${node.symbols.map(s => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:var(--indigo-400);padding:1px 0;">${safeHTML(s)}()</div>`).join('')}
    </div>` : ''}
    ${imports.length ? `<div style="margin-bottom:8px;">
      <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Imports (${imports.length})</div>
      ${imports.slice(0, 6).map(f => `<div style="font-size:10px;color:var(--text-secondary);word-break:break-all;">→ ${safeHTML(f)}</div>`).join('')}${imports.length > 6 ? `<div style="font-size:10px;color:var(--text-muted);">…+${imports.length - 6} more</div>` : ''}
    </div>` : ''}
    ${importedBy.length ? `<div>
      <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Imported by (${importedBy.length})</div>
      ${importedBy.slice(0, 4).map(f => `<div style="font-size:10px;color:var(--text-secondary);word-break:break-all;">← ${safeHTML(f)}</div>`).join('')}${importedBy.length > 4 ? `<div style="font-size:10px;color:var(--text-muted);">…+${importedBy.length - 4} more</div>` : ''}
    </div>` : ''}
    ${!node.symbols.length && !imports.length && !importedBy.length ? '<div style="color:var(--text-muted);font-style:italic;">No symbols or imports detected.</div>' : ''}`;
}

// =========================================================================
// VIEW: CONTROL CENTER (Ticket Builder + Agent Editor + Usage)
// =========================================================================

function renderControl(container) {
  if (!STATE.config) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)"><div class="spinner" style="margin:0 auto 16px"></div>Loading ZAF configurations…</div>`;
    fetch('/api/config').then(r => r.json()).then(c => { STATE.config = c; renderControl(container); }).catch(() => {});
    return;
  }

  const tab = STATE.controlTab || 'ticket';
  const tabs = [
    { id:'ticket',      label:'Ticket Builder',    icon:'TKT' },
    { id:'agents',      label:'Agent Editor',      icon:'AGT' },
    { id:'marketplace', label:'Marketplace',       icon:'MKT' },
    { id:'skills',      label:'Skill Library',     icon:'SKL' },
    { id:'usage',       label:'Telemetry & Usage', icon:'USE' },
    { id:'cli-hub',     label:'CLI Hub',           icon:'CLI' },
  ];
  const tabsHtml = tabs.map(t => `<button class="zaf-control-tab ${tab===t.id?'active':''}" data-tab="${t.id}"><span>${t.icon}</span> ${t.label}</button>`).join('');

  let body = '';
  if (tab === 'ticket')           body = renderControlTicketBuilder();
  else if (tab === 'agents')      body = renderControlAgentEditor();
  else if (tab === 'marketplace') body = renderControlMarketplace();
  else if (tab === 'skills')      body = renderControlSkills();
  else if (tab === 'usage')       body = renderControlUsage();
  else if (tab === 'cli-hub')     body = renderControlCliHub();

  container.innerHTML = `
    <div class="zaf-control-wrap fade-in">
      <div class="zaf-overview-header" style="padding-bottom:14px;margin-bottom:16px">
        <div>
          <div class="zaf-overview-title"><div class="accent-bar"></div>ZAF Sovereign Control Center</div>
          <div class="zaf-overview-sub">Construct tickets, calibrate agent personas, monitor subscription telemetry.</div>
        </div>
      </div>
      <div class="zaf-control-tabs">${tabsHtml}</div>
      ${body}
    </div>`;
  container.querySelectorAll('.zaf-control-tab').forEach(b => b.addEventListener('click', () => { STATE.controlTab = b.dataset.tab; renderControl(container); }));

  if (tab === 'ticket')      wireTicketBuilder(container);
  if (tab === 'agents')      wireAgentEditor(container);
  if (tab === 'marketplace') wireMarketplace(container);
  if (tab === 'skills')      wireSkillLibrary(container);
  if (tab === 'cli-hub')     wireCliHub(container);
}

// ---- Ticket builder ----
function renderControlTicketBuilder() {
  return `
    <div class="zaf-control-card" style="max-width:780px">
      <h2>Construct New Ticket Context</h2>
      <form id="zaf-ticket-form" style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        <div class="zaf-field" style="grid-column:1/3"><label>Target Repo</label>
          <select id="tkt-repo">
            ${(STATE.data?.repos||[]).map(r => `<option value="${r.id}" ${r.id==='zaf'?'selected':''}>${r.id}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field" style="grid-column:1/3"><label>Title</label>
          <input id="tkt-title" required placeholder="e.g. Wire OAuth callback validation" />
        </div>
        <div class="zaf-field"><label>Phase Gate</label><select id="tkt-phase"></select></div>
        <div class="zaf-field"><label>Workstream</label><select id="tkt-workstream"></select></div>
        <div class="zaf-field"><label>Priority</label>
          <select id="tkt-priority">
            <option value="P0">P0 — Critical</option>
            <option value="P1">P1 — High</option>
            <option value="P2" selected>P2 — Normal</option>
            <option value="P3">P3 — Low</option>
          </select>
        </div>
        <div class="zaf-field"><label>Assigned Agent Role</label>
          <select id="tkt-role">${Object.keys(STATE.config.agents).map(k => `<option value="${k}">${STATE.config.agents[k].roleName} (${k})</option>`).join('')}</select>
        </div>
        <div class="zaf-field" style="grid-column:1/3"><label>Task Context & Description</label>
          <textarea id="tkt-description" rows="6" required placeholder="Describe the goal, background context, and acceptance criteria…"></textarea>
        </div>
        <div style="grid-column:1/3"><button type="submit" class="zaf-btn">Create Ticket & Auto-Index</button></div>
      </form>
    </div>`;
}

function wireTicketBuilder(container) {
  const tktRepo = container.querySelector('#tkt-repo');
  if (!tktRepo) return;
  const updateSelectors = () => {
    const repo = tktRepo.value;
    const phaseSel = container.querySelector('#tkt-phase');
    const wsSel = container.querySelector('#tkt-workstream');
    if (repo === 'zo') {
      phaseSel.innerHTML = `
        <option value="P0">Phase 0 — Baseline</option><option value="P1" selected>Phase 1 — Design Lock</option>
        <option value="P2">Phase 2 — Shell V1</option><option value="P3">Phase 3 — Services</option>
        <option value="P4">Phase 4 — Dual-Import</option><option value="P5">Phase 5 — Attio Cutover</option>
        <option value="P6">Phase 6 — Intelligence</option>`;
      wsSel.innerHTML = `<option value="WS-UX" selected>WS-UX</option><option value="WS-SHELL">WS-SHELL</option>
        <option value="WS-DATA">WS-DATA</option><option value="WS-SERVICES">WS-SERVICES</option>
        <option value="WS-CRM">WS-CRM</option><option value="WS-INTELLIGENCE">WS-INTELLIGENCE</option>
        <option value="WS-ASSISTANT">WS-ASSISTANT</option><option value="WS-REPOS">WS-REPOS</option>`;
    } else {
      phaseSel.innerHTML = `<option value="P1">Phase 1 — Multi-Repo</option><option value="P2">Phase 2 — Docs</option>
        <option value="P3">Phase 3 — CLI</option><option value="P4" selected>Phase 4 — Control</option>
        <option value="P5">Phase 5 — Paperclip Parity</option>`;
      wsSel.innerHTML = `<option value="WS-CLI">WS-CLI</option><option value="WS-DASHBOARD">WS-DASHBOARD</option>
        <option value="WS-UX" selected>WS-UX</option><option value="WS-DOCS">WS-DOCS</option><option value="none">none</option>`;
    }
  };
  tktRepo.addEventListener('change', updateSelectors);
  updateSelectors();

  container.querySelector('#zaf-ticket-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title:       container.querySelector('#tkt-title').value,
      description: container.querySelector('#tkt-description').value,
      phase:       container.querySelector('#tkt-phase').value,
      workstream:  container.querySelector('#tkt-workstream').value,
      priority:    container.querySelector('#tkt-priority').value,
      role:        container.querySelector('#tkt-role').value,
      repo:        container.querySelector('#tkt-repo').value,
    };
    try {
      const r = await fetch('/api/ticket/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      alert('Created ' + data.ticketId);
      await loadData();
      navigateTo('board');
    } catch (err) {
      alert('Create failed: ' + err.message);
    }
  });
}

// ---- Agent editor ---- (TKT-ZAF-0029: personality-first, real model IDs, advanced section)
function renderControlAgentEditor() {
  const agents = STATE.config.agents;
  const keys = Object.keys(agents);
  const key = STATE.selectedAgentKey || keys[0];
  const a = agents[key] || { roleName:'', modelId:'claude-sonnet-4-6', personality:'', reasoning:'medium', heartbeat:40, harness:'mock', structuralRole:'worker', manager:null, tools:[] };
  const tools = STATE.config.toolsRegistry || [];

  const opt = (val, sel, label) => `<option value="${val}" ${sel===val?'selected':''}>${label}</option>`;

  // Model dropdown options per harness
  const harness = a.harness || 'mock';
  const modelOptions = HARNESS_MODEL_IDS[harness]
    ? HARNESS_MODEL_IDS[harness].map(m => opt(m.id, a.modelId || '', `${m.id} — ${m.label}`)).join('')
    : `<option value="" disabled>N/A</option>`;
  const modelDisabled = !HARNESS_MODEL_IDS[harness] ? 'disabled title="Model selection N/A for this harness"' : '';

  // Reasoning capability + note (TKT-ZAF-0044)
  const reasoningCap = REASONING_CAPABILITY[harness] || { values: null, forwarded: false, note: '' };
  const reasoningNote = reasoningCap.note || '';
  const reasoningSupported = Array.isArray(reasoningCap.values);
  const reasoningValues = reasoningSupported ? reasoningCap.values : [];

  // Recommended badge — only meaningful for Claude family (the only family whose model IDs the
  // recommendations reference); hide for non-Claude CLIs to avoid suggesting Sonnet 4.6 on codex/gemini.
  const isClaudeFamily = (harness === 'claude-code' || harness === 'claude');
  const rec = ROLE_RECOMMENDATIONS[a.structuralRole];
  const recBadgeHtml = (rec && isClaudeFamily) ? `<span class="rec-badge" title="Recommended for ${a.structuralRole}">${rec.label}</span>
    <button type="button" class="use-recommended-btn" id="use-recommended-btn">Use recommended</button>` : '';

  return `
    <div class="zaf-control-grid">
      <div class="zaf-control-card">
        <h2>Agent Builder</h2>
        <div class="zaf-field"><label>Select Agent Profile</label>
          <select id="agent-selector">${keys.map(k => `<option value="${k}" ${k===key?'selected':''}>${agents[k].roleName} (${k})</option>`).join('')}</select>
        </div>
        <form id="zaf-agent-form" style="display:flex;flex-direction:column;gap:12px;">
          <div class="zaf-field"><label>Role Name</label><input id="agent-name" value="${safeHTML(a.roleName)}" /></div>

          <div class="zaf-field">
            <label>Personality &amp; Scope</label>
            <textarea id="agent-personality" rows="6" style="resize:vertical" placeholder="Describe who this agent is, how they approach problems, and what their operational boundaries are. This text is injected directly into every seed prompt.">${safeHTML(a.personality || '')}</textarea>
          </div>

          <div class="zaf-field"><label>Default Harness</label>
            <select id="agent-harness">
              ${getAllHarnessOptions().map(h => opt(h.id, harness, h.label)).join('')}
            </select>
          </div>

          <div class="zaf-field">
            <label>Model ${recBadgeHtml}</label>
            <div class="model-row">
              <select id="agent-modelid" ${modelDisabled} style="flex:1">${modelOptions}</select>
            </div>
          </div>

          <div class="zaf-field" id="agent-reasoning-field" style="${reasoningSupported ? '' : 'display:none'}">
            <label>Reasoning Level</label>
            <select id="agent-reasoning">
              ${reasoningValues.map(r => opt(r, a.reasoning || 'medium', r)).join('')}
            </select>
            ${reasoningNote ? `<div class="reasoning-note">${reasoningNote}</div>` : ''}
          </div>

          <div class="zaf-field"><label>Structural Role (alters generated persona & bounds)</label>
            <select id="agent-struct-role">
              ${Object.entries(STRUCTURAL_PERSONAS).map(([id,p]) => `<option value="${id}" ${(a.structuralRole||'worker')===id?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="zaf-persona-preview" id="persona-preview"></div>

          <div class="zaf-field"><label>Supervisor (N+1)</label>
            <select id="agent-manager">
              <option value="">None (reports to operator)</option>
              ${keys.filter(k => k !== key).map(k => `<option value="${k}" ${(a.manager||'')===k?'selected':''}>${agents[k].roleName} (${k})</option>`).join('')}
            </select>
          </div>

          <details class="agent-advanced-section">
            <summary>Advanced</summary>
            <div class="agent-advanced-inner">
              <div class="zaf-field"><label><span>Heartbeat Interval</span><span class="zaf-heartbeat-val" id="heartbeat-val">${formatHeartbeat(a.heartbeat || 40)}</span></label>
                <div class="zaf-heartbeat-row"><input type="range" id="agent-heartbeat" min="0" max="${HEARTBEAT_TICKS.length - 1}" step="1" value="${heartbeatSecondsToTickIndex(a.heartbeat || 40)}" /></div>
                <div class="zaf-heartbeat-hint">Internal plumbing — how often the subshell emits a heartbeat tick. Scale: 5s → 7 days.</div>
              </div>

              <div class="zaf-field"><label>Authorized CLIs</label>
                <div id="agent-harness-multi" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--bg-input);border:1px solid var(--border-medium);padding:10px 12px;border-radius:var(--radius-sm);">
                  ${getAllHarnessOptions().map(h => {
                    const isActive = (Array.isArray(a.harnesses) && a.harnesses.length)
                      ? a.harnesses.includes(h.id)
                      : (a.harness === h.id);
                    return `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                      <input type="checkbox" class="agent-harness-cb" value="${h.id}" ${isActive?'checked':''} style="accent-color:var(--indigo-400);" />
                      <span>${h.label}</span>
                    </label>`;
                  }).join('')}
                </div>
              </div>

              <div class="zaf-field"><label>Authorized Tools</label>
                <div style="display:flex;flex-direction:column;gap:6px;background:var(--bg-input);border:1px solid var(--border-medium);padding:12px 14px;border-radius:var(--radius-sm);">
                  ${tools.map(t => `
                    <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
                      <input type="checkbox" class="agent-tool-cb" value="${t.id}" ${(a.tools||[]).includes(t.id)?'checked':''} style="accent-color:var(--indigo-400);margin-top:2px;" />
                      <div><strong style="color:var(--text-primary);">${t.name}</strong>
                      <div style="font-size:10px;color:var(--text-muted);">${safeHTML(t.description)}</div></div>
                    </label>`).join('') || '<span style="color:var(--text-muted);font-size:11px">No tools registered yet.</span>'}
                </div>
              </div>

              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button type="button" class="zaf-btn secondary" id="cli-probe-btn">⚙ Probe capabilities</button>
                <span id="cli-probe-status" style="font-size:11px;color:var(--text-muted)"></span>
              </div>
              <div class="zaf-discovery-result" id="cli-probe-result" style="display:none"></div>
            </div>
          </details>

          <button type="submit" class="zaf-btn">Save Agent</button>
        </form>
      </div>

      <div class="zaf-control-card">
        <h2>Tools Registry</h2>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${tools.map(t => `
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px 14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-weight:700;color:var(--indigo-400);font-family:'JetBrains Mono',monospace;font-size:12px;">${t.id}</span>
                <span style="font-size:11px;font-weight:600;color:var(--text-primary);">${t.name}</span>
              </div>
              <div style="font-size:10px;color:var(--text-muted);line-height:1.4;">${safeHTML(t.description)}</div>
            </div>`).join('')}
        </div>
        <form id="tool-form" style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
          <h2 style="margin-top:4px">Register Tool</h2>
          <div class="zaf-field"><label>Tool ID</label><input id="new-tool-id" placeholder="e.g. DockerCompose" required /></div>
          <div class="zaf-field"><label>Display Name</label><input id="new-tool-name" placeholder="Docker Compose orchestrator" required /></div>
          <div class="zaf-field"><label>Capability description & bounds</label><textarea id="new-tool-desc" rows="3" required></textarea></div>
          <button type="submit" class="zaf-btn">Enroll Tool</button>
        </form>
      </div>
    </div>`;
}

function wireAgentEditor(container) {
  const selector = container.querySelector('#agent-selector');
  selector?.addEventListener('change', () => { STATE.selectedAgentKey = selector.value; renderControl(container); });

  const slider = container.querySelector('#agent-heartbeat');
  const sliderVal = container.querySelector('#heartbeat-val');
  slider?.addEventListener('input', () => {
    const idx = +slider.value;
    sliderVal.textContent = formatHeartbeat(HEARTBEAT_TICKS[idx] ?? 40);
  });

  const personaPreview = container.querySelector('#persona-preview');
  const updatePersona = () => {
    const id = container.querySelector('#agent-struct-role').value;
    const p = STRUCTURAL_PERSONAS[id];
    if (!p) return;
    personaPreview.textContent =
`STRUCTURAL ROLE: ${p.label}
─────────────────────────────────
PERSONA INSTRUCTION:
${p.persona}

OPERATIONAL BOUNDS:
${p.bounds}`;
  };
  container.querySelector('#agent-struct-role')?.addEventListener('change', updatePersona);
  updatePersona();

  // When harness changes, update model dropdown options.
  // Source order (TKT-ZAF-0043): probed CLI models (from /api/cli/discover) merged with curated
  // defaults in HARNESS_MODEL_IDS. Probed models keep the CLI's own labels; curated defaults
  // remain a stable fallback when probing returns nothing.
  const harnessSel = container.querySelector('#agent-harness');
  const modelSel   = container.querySelector('#agent-modelid');
  const probedModelsCache = {}; // harness -> [{id,label}]
  const updateModelDropdown = async () => {
    if (!modelSel || !harnessSel) return;
    const h = harnessSel.value;
    const curated = HARNESS_MODEL_IDS[h] || [];
    let probed = probedModelsCache[h];
    if (probed === undefined) {
      probed = null;
      try {
        const r = await fetch(`/api/cli/discover?harness=${encodeURIComponent(h)}`);
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.models) && data.models.length) {
            probed = data.models.map(m => ({ id: m, label: 'probed' }));
          }
        }
      } catch (_) { /* network or probe failure — fall through to curated */ }
      probedModelsCache[h] = probed;
    }
    const merged = [];
    const seen = new Set();
    for (const m of (probed || [])) { if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); } }
    for (const m of curated)         { if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); } }
    if (!merged.length) {
      modelSel.innerHTML = '<option value="" disabled>N/A for this harness — operator can edit defaults</option>';
      modelSel.disabled = true;
    } else {
      modelSel.disabled = false;
      modelSel.innerHTML = merged.map(m => `<option value="${m.id}">${m.id} — ${m.label}</option>`).join('');
    }
    updateReasoningNote();
    updateRecBadge();
  };
  harnessSel?.addEventListener('change', updateModelDropdown);

  // Update reasoning note + field visibility + accepted values when harness changes (TKT-ZAF-0044)
  const updateReasoningNote = () => {
    if (!harnessSel) return;
    const h = harnessSel.value;
    const cap = REASONING_CAPABILITY[h] || { values: null, note: '' };
    const fieldEl = container.querySelector('#agent-reasoning-field');
    const noteEl  = container.querySelector('.reasoning-note');
    const selEl   = container.querySelector('#agent-reasoning');
    const supported = Array.isArray(cap.values);
    if (fieldEl) fieldEl.style.display = supported ? '' : 'none';
    if (noteEl)  noteEl.textContent = cap.note || '';
    if (selEl && supported) {
      const prev = selEl.value;
      selEl.innerHTML = cap.values.map(v => `<option value="${v}" ${prev===v?'selected':''}>${v}</option>`).join('');
      if (!cap.values.includes(prev)) selEl.value = cap.values.includes('medium') ? 'medium' : cap.values[0];
    }
  };

  // Update recommended badge when structural role changes.
  // Hide entirely when a non-Claude harness is selected (TKT-ZAF-0043) so we don't suggest
  // Sonnet 4.6 on codex/gemini.
  const updateRecBadge = () => {
    const structRoleSel = container.querySelector('#agent-struct-role');
    const recBadge = container.querySelector('.rec-badge');
    const recBtn   = container.querySelector('#use-recommended-btn');
    const h = harnessSel?.value || '';
    const isClaude = (h === 'claude-code' || h === 'claude');
    const display = isClaude ? '' : 'none';
    if (recBadge) recBadge.style.display = display;
    if (recBtn)   recBtn.style.display   = display;
    if (!structRoleSel || !recBadge) return;
    const rec = ROLE_RECOMMENDATIONS[structRoleSel.value];
    if (rec) recBadge.textContent = rec.label;
  };
  container.querySelector('#agent-struct-role')?.addEventListener('change', updateRecBadge);

  // Use recommended button
  container.querySelector('#use-recommended-btn')?.addEventListener('click', () => {
    const structRoleSel = container.querySelector('#agent-struct-role');
    const rec = ROLE_RECOMMENDATIONS[structRoleSel?.value];
    if (!rec) return;
    if (modelSel) modelSel.value = rec.modelId;
    const reasoningSel = container.querySelector('#agent-reasoning');
    if (reasoningSel) reasoningSel.value = rec.reasoning;
  });

  // CLI probe (in Advanced section)
  container.querySelector('#cli-probe-btn')?.addEventListener('click', async () => {
    const harness = harnessSel?.value || 'claude-code';
    const statusEl = container.querySelector('#cli-probe-status');
    const resultEl = container.querySelector('#cli-probe-result');
    statusEl.textContent = `Probing ${harness} …`;
    try {
      const cached = STATE.cliDiscoveryCache[harness];
      const r = cached || await fetch('/api/cli/discover?harness=' + encodeURIComponent(harness)).then(r => r.json());
      STATE.cliDiscoveryCache[harness] = r;
      statusEl.textContent = `Probed ${harness}.`;
      resultEl.style.display = 'block';
      const modelPills = r.models?.length ? r.models.slice(0, 24).map(m => `<span class="disc-pill">${m}</span>`).join('') : '<em>none parsed</em>';
      const flagPills  = r.flags?.length ? r.flags.slice(0, 30).map(f => `<span class="disc-pill">${safeHTML(f)}</span>`).join('') : '<em>none parsed</em>';
      resultEl.innerHTML = `
        <div><span class="disc-status ${r.ok?'ok':'fail'}">${r.ok?'OK':'WARN'}</span><strong>${harness}</strong> — capabilities discovered from <code>--help</code></div>
        <div class="disc-section">Models</div>${modelPills}
        <div class="disc-section">Flags</div>${flagPills}
        <div class="disc-section">Raw output (first 400 chars)</div>
        <pre style="font-size:10px;color:var(--text-muted);white-space:pre-wrap">${safeHTML((r.raw||'').slice(0, 400))}</pre>`;
    } catch (err) {
      statusEl.textContent = 'Probe failed: ' + err.message;
    }
  });

  // Save form
  container.querySelector('#zaf-agent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = selector.value;
    const c = STATE.config.agents[key];
    c.roleName       = container.querySelector('#agent-name').value;
    c.personality    = container.querySelector('#agent-personality')?.value || '';
    c.modelId        = container.querySelector('#agent-modelid')?.value || '';
    c.reasoning      = container.querySelector('#agent-reasoning').value;
    c.harness        = harnessSel?.value || 'mock';
    c.harnesses      = Array.from(container.querySelectorAll('.agent-harness-cb:checked')).map(cb => cb.value);
    if (!c.harnesses.length) c.harnesses = [c.harness];
    if (!c.harnesses.includes(c.harness)) c.harness = c.harnesses[0];
    c.structuralRole = container.querySelector('#agent-struct-role').value;
    c.manager        = container.querySelector('#agent-manager').value || null;
    c.heartbeat      = HEARTBEAT_TICKS[+slider?.value] ?? 40;
    c.tools          = Array.from(container.querySelectorAll('.agent-tool-cb:checked')).map(cb => cb.value);
    await persistConfig();
    alert('Saved ' + c.roleName);
    renderControl(container);
  });

  // Tool registration
  container.querySelector('#tool-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = container.querySelector('#new-tool-id').value.replace(/[^a-zA-Z0-9]/g, '');
    const name = container.querySelector('#new-tool-name').value;
    const description = container.querySelector('#new-tool-desc').value;
    if (!id) return alert('Tool ID must be alphanumeric');
    STATE.config.toolsRegistry = STATE.config.toolsRegistry || [];
    if (STATE.config.toolsRegistry.find(t => t.id === id)) return alert('Tool ID exists');
    STATE.config.toolsRegistry.push({ id, name, description });
    await persistConfig();
    renderControl(container);
  });
}

async function persistConfig() {
  const r = await fetch('/api/config/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(STATE.config) });
  if (!r.ok) alert('Config save failed: HTTP ' + r.status);
}

// ---- Marketplace ----
function renderControlMarketplace() {
  const agents = STATE.config.agents || {};
  const imported = Object.entries(agents).filter(([,a]) => a.source);
  const local    = Object.entries(agents).filter(([,a]) => !a.source);
  const packs    = STATE.config.importedPacks || [];

  const agentCard = ([key, a], showDupe = true) => `
    <div class="mkt-agent-card" data-key="${safeHTML(key)}">
      <div class="mkt-agent-header">
        <span class="mkt-agent-name">${safeHTML(a.roleName || key)}</span>
        <span class="mkt-agent-key">${safeHTML(key)}</span>
        ${a.source ? `<span class="mkt-badge-imported" title="${safeHTML(a.source)}">imported</span>` : '<span class="mkt-badge-local">local</span>'}
      </div>
      <div class="mkt-agent-meta">
        <span>${safeHTML(a.harness || '—')}</span>
        <span>${safeHTML(a.structuralRole || 'worker')}</span>
        <span>${safeHTML(a.modelId || '—')}</span>
      </div>
      ${a.personality ? `<div class="mkt-agent-excerpt">${safeHTML(a.personality.slice(0, 120))}${a.personality.length > 120 ? '…' : ''}</div>` : ''}
      <div class="mkt-agent-actions">
        ${showDupe ? `<button class="console-btn mkt-dupe-btn" data-key="${safeHTML(key)}">Duplicate to local</button>` : ''}
      </div>
    </div>`;

  const packRows = packs.map((p, idx) => `
    <div class="mkt-pack-row">
      <span class="mkt-pack-source" title="${safeHTML(p.source)}">${safeHTML(p.source)}</span>
      <span class="mkt-pack-count">${p.count} agent${p.count !== 1 ? 's' : ''}</span>
      <span class="mkt-pack-date">${p.importedAt ? new Date(p.importedAt).toLocaleDateString() : ''}</span>
      <button class="console-btn mkt-check-updates-btn" data-source="${safeHTML(p.source)}" data-idx="${idx}">Check for updates</button>
    </div>
    <div class="mkt-update-diff" id="mkt-update-diff-${idx}" style="display:none;margin:4px 0 12px;"></div>`).join('');

  // Import defaults (TKT-ZAF-0049) — values applied to imported agents whose pack manifest is silent.
  const md = STATE.config.marketplaceDefaults || {};
  const harnessOpts = getAllHarnessOptions();
  const defaultsCard = `
    <div class="zaf-control-card" style="max-width:900px;margin-bottom:20px;">
      <h2 style="margin-bottom:6px">Import Defaults</h2>
      <p style="color:var(--text-secondary);font-size:12px;margin-bottom:14px">Applied to imported agents when the pack manifest does not specify a value. Pack-specified values still win.</p>
      <form id="mkt-defaults-form" style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:12px;">
        <div class="zaf-field"><label>Default CLI / Harness</label>
          <select id="mkt-def-harness">
            <option value="">— none —</option>
            ${harnessOpts.map(h => `<option value="${h.id}" ${md.harness===h.id?'selected':''}>${h.label}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Default Model ID</label>
          <input id="mkt-def-model" type="text" value="${safeHTML(md.modelId || '')}" placeholder="e.g. claude-sonnet-4-6" />
        </div>
        <div class="zaf-field"><label>Default Reasoning</label>
          <select id="mkt-def-reasoning">
            ${['','low','medium','high'].map(v => `<option value="${v}" ${md.reasoning===v?'selected':''}>${v||'— none —'}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Default Structural Role</label>
          <select id="mkt-def-struct">
            <option value="">— none —</option>
            ${Object.entries(STRUCTURAL_PERSONAS).map(([id,p]) => `<option value="${id}" ${md.structuralRole===id?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Default Heartbeat (s)</label>
          <input id="mkt-def-heartbeat" type="number" min="5" max="300" step="5" value="${md.heartbeat || ''}" placeholder="40" />
        </div>
        <div style="grid-column:1/4;display:flex;gap:10px;align-items:center;">
          <button type="submit" class="zaf-btn">Save Defaults</button>
          <span id="mkt-def-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
      </form>
    </div>`;

  return `
    ${defaultsCard}
    <div class="zaf-control-card" style="max-width:900px">
      <h2>Agent Marketplace</h2>
      <p style="color:var(--text-secondary);margin-bottom:20px;font-size:13px">Import agent packs from a git URL. Supports Format A (.md frontmatter) and Format B (agents.json).</p>

      <div class="mkt-import-row">
        <input id="mkt-url" type="text" placeholder="https://github.com/user/repo" style="flex:1;min-width:0" />
        <input id="mkt-subdir" type="text" placeholder="subdir (optional)" style="width:160px" />
        <button class="zaf-btn" id="mkt-preview-btn">Preview Pack</button>
      </div>
      <div id="mkt-preview-area" style="margin-top:16px"></div>

      ${packs.length ? `<div style="margin-top:28px"><div class="zaf-field-label" style="margin-bottom:8px">Imported Packs</div>${packRows}</div>` : ''}

      <div style="margin-top:28px">
        <div class="zaf-field-label" style="margin-bottom:10px">Imported Agents (${imported.length})</div>
        ${imported.length ? `<div class="mkt-agent-grid">${imported.map(e => agentCard(e, true)).join('')}</div>` : '<div style="color:var(--text-muted);font-size:12px">No imported agents yet.</div>'}
      </div>

      <div style="margin-top:28px">
        <div class="zaf-field-label" style="margin-bottom:10px">Local Agents (${local.length})</div>
        <div class="mkt-agent-grid">${local.map(e => agentCard(e, false)).join('')}</div>
      </div>
    </div>`;
}

function wireMarketplace(container) {
  // Marketplace import defaults form (TKT-ZAF-0049)
  const defForm = container.querySelector('#mkt-defaults-form');
  if (defForm) {
    defForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = container.querySelector('#mkt-def-status');
      const payload = {
        harness:        container.querySelector('#mkt-def-harness').value,
        modelId:        container.querySelector('#mkt-def-model').value.trim(),
        reasoning:      container.querySelector('#mkt-def-reasoning').value,
        structuralRole: container.querySelector('#mkt-def-struct').value,
        heartbeat:      container.querySelector('#mkt-def-heartbeat').value,
      };
      statusEl.textContent = 'Saving…';
      try {
        const r = await fetch('/api/config/marketplace-defaults', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        STATE.config = STATE.config || {};
        STATE.config.marketplaceDefaults = d.defaults || payload;
        statusEl.textContent = '✓ Saved — applied to future imports';
      } catch (err) {
        statusEl.textContent = '✗ ' + err.message;
      }
    });
  }

  const previewBtn = container.querySelector('#mkt-preview-btn');
  if (!previewBtn) return;
  const urlInput  = container.querySelector('#mkt-url');
  const subdirInp = container.querySelector('#mkt-subdir');
  const previewArea = container.querySelector('#mkt-preview-area');

  previewBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return alert('Enter a git URL first');
    previewBtn.disabled = true;
    previewBtn.textContent = 'Cloning…';
    previewArea.innerHTML = `<div style="color:var(--text-muted);font-size:12px">Cloning and scanning — this may take a few seconds…</div>`;
    try {
      const r = await fetch('/api/marketplace/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, subdir: subdirInp.value.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Preview failed');
      if (!data.agents.length) {
        previewArea.innerHTML = `<div style="color:var(--text-secondary);font-size:12px">No agents found. Check URL and subdir, or confirm the pack uses .md frontmatter or agents.json format.</div>`;
        return;
      }
      let html = `<div style="margin-bottom:10px;color:var(--text-secondary);font-size:12px">Found <strong style="color:var(--text-primary)">${data.agents.length}</strong> agent${data.agents.length !== 1 ? 's' : ''} in pack.</div>`;
      html += `<div class="mkt-agent-grid" id="mkt-preview-grid">`;
      for (const a of data.agents) {
        html += `<div class="mkt-agent-card mkt-preview-card" data-key="">
          <label class="mkt-check-label">
            <input type="checkbox" class="mkt-sel-cb" checked />
            <span class="mkt-agent-name">${safeHTML(a.roleName || '—')}</span>
          </label>
          <div class="mkt-agent-meta">
            <span>${safeHTML(a.harness || '—')}</span>
            <span>${safeHTML(a.structuralRole || 'worker')}</span>
            <span>${safeHTML(a.modelId || '—')}</span>
          </div>
          ${a.personality ? `<div class="mkt-agent-excerpt">${safeHTML(a.personality.slice(0, 100))}${a.personality.length > 100 ? '…' : ''}</div>` : ''}
        </div>`;
      }
      html += `</div>`;
      html += `<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="zaf-btn" id="mkt-import-btn">Import selected</button>
        <button type="button" class="zaf-btn secondary" id="mkt-select-all">Select all</button>
        <button type="button" class="zaf-btn secondary" id="mkt-deselect-all">Deselect all</button>
        <span id="mkt-import-status" style="font-size:12px;color:var(--text-muted)"></span>
      </div>`;
      previewArea.innerHTML = html;

      // Bulk select / deselect (TKT-ZAF-0050)
      previewArea.querySelector('#mkt-select-all')?.addEventListener('click', () => {
        previewArea.querySelectorAll('.mkt-sel-cb').forEach(cb => { cb.checked = true; });
      });
      previewArea.querySelector('#mkt-deselect-all')?.addEventListener('click', () => {
        previewArea.querySelectorAll('.mkt-sel-cb').forEach(cb => { cb.checked = false; });
      });

      const importBtn = previewArea.querySelector('#mkt-import-btn');
      importBtn.addEventListener('click', async () => {
        const checkboxes = previewArea.querySelectorAll('.mkt-sel-cb');
        const selected = data.agents.filter((_, i) => checkboxes[i]?.checked);
        if (!selected.length) return alert('Select at least one agent to import');
        importBtn.disabled = true;
        const statusEl = previewArea.querySelector('#mkt-import-status');
        statusEl.textContent = 'Importing…';
        try {
          const ir = await fetch('/api/marketplace/import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agents: selected, source: url }),
          });
          const id = await ir.json();
          if (!ir.ok) throw new Error(id.error || 'Import failed');
          STATE.config = null; // force refresh
          statusEl.textContent = `✓ Imported ${id.imported} agent${id.imported !== 1 ? 's' : ''}`;
          setTimeout(() => { STATE.controlTab = 'marketplace'; renderControl(container); }, 900);
        } catch (e) {
          statusEl.textContent = `Error: ${e.message}`;
          importBtn.disabled = false;
        }
      });
    } catch (e) {
      previewArea.innerHTML = `<div style="color:var(--status-blocked);font-size:12px">Error: ${safeHTML(e.message)}</div>`;
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview Pack';
    }
  });

  // Check for updates buttons (TKT-ZAF-0037)
  container.querySelectorAll('.mkt-check-updates-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const source = btn.dataset.source;
      const idx    = btn.dataset.idx;
      const diffEl = container.querySelector(`#mkt-update-diff-${idx}`);
      if (!diffEl) return;
      if (diffEl.style.display !== 'none') { diffEl.style.display = 'none'; return; }
      btn.disabled = true;
      btn.textContent = 'Fetching…';
      diffEl.style.display = 'block';
      diffEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px">Cloning and comparing — may take a few seconds…</div>`;
      try {
        const r = await fetch('/api/marketplace/check-updates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Check failed');
        const { added, changed, removed } = d;
        if (!added.length && !changed.length && !removed.length) {
          diffEl.innerHTML = `<div style="color:var(--status-done,#10b981);font-size:12px">✓ Pack is up to date — no changes detected.</div>`;
          return;
        }
        let html = `<div style="font-size:12px;margin-bottom:10px;color:var(--text-secondary)">Diff: <strong style="color:var(--text-primary)">${added.length} new</strong> · <strong style="color:#fbbf24">${changed.length} changed</strong> · <strong style="color:var(--text-muted)">${removed.length} removed (info only)</strong></div>`;
        const items = [
          ...added.map(({ key, agent }) => ({ key, agent, type: 'new' })),
          ...changed.map(({ key, incoming }) => ({ key, agent: incoming, type: 'changed' })),
        ];
        if (items.length) {
          html += `<div class="mkt-agent-grid" id="mkt-diff-grid-${idx}">`;
          for (const { key, agent, type } of items) {
            html += `<div class="mkt-agent-card">
              <div class="mkt-agent-header">
                <label class="mkt-check-label"><input type="checkbox" class="mkt-upd-cb" data-key="${safeHTML(key)}" checked />
                <span class="mkt-agent-name">${safeHTML(agent.roleName || key)}</span></label>
                <span class="${type === 'new' ? 'mkt-badge-local' : 'mkt-badge-imported'}" style="margin-left:auto">${type}</span>
              </div>
              <div class="mkt-agent-meta"><span>${safeHTML(agent.harness||'—')}</span><span>${safeHTML(agent.structuralRole||'worker')}</span></div>
            </div>`;
          }
          html += `</div>`;
          html += `<div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <button class="zaf-btn mkt-apply-updates-btn" data-source="${safeHTML(source)}" data-idx="${idx}">Apply selected</button>
            <span class="mkt-apply-status" style="font-size:12px;color:var(--text-muted)"></span>
          </div>`;
        }
        if (removed.length) {
          html += `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">${removed.map(({ key }) => `${safeHTML(key)} removed from pack`).join(' · ')}</div>`;
        }
        diffEl.innerHTML = html;

        // Wire apply
        const applyBtn = diffEl.querySelector('.mkt-apply-updates-btn');
        if (applyBtn) {
          applyBtn.addEventListener('click', async () => {
            const checks = diffEl.querySelectorAll('.mkt-upd-cb:checked');
            const updates = items.filter((_, i) => checks[i]?.checked);
            if (!updates.length) return alert('Select at least one update to apply');
            applyBtn.disabled = true;
            const statusEl = diffEl.querySelector('.mkt-apply-status');
            statusEl.textContent = 'Applying…';
            try {
              const ar = await fetch('/api/marketplace/apply-updates', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, updates: updates.map(({ key, agent }) => ({ key, agent })) }),
              });
              const ad = await ar.json();
              if (!ar.ok) throw new Error(ad.error || 'Apply failed');
              STATE.config = null;
              statusEl.textContent = `✓ Applied ${ad.applied} update${ad.applied !== 1 ? 's' : ''}`;
              setTimeout(() => { STATE.controlTab = 'marketplace'; renderControl(container); }, 800);
            } catch (e) {
              statusEl.textContent = 'Error: ' + e.message;
              applyBtn.disabled = false;
            }
          });
        }
      } catch (e) {
        diffEl.innerHTML = `<div style="color:var(--status-blocked);font-size:12px">Error: ${safeHTML(e.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Check for updates';
      }
    });
  });

  // Right-pane agent detail flyout (TKT-ZAF-0050)
  container.querySelectorAll('.mkt-agent-card[data-key]').forEach(card => {
    const key = card.dataset.key;
    if (!key) return;
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label')) return;
      openAgentDetailFlyout(key, container);
    });
  });

  // Duplicate buttons
  container.querySelectorAll('.mkt-dupe-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      btn.disabled = true;
      btn.textContent = 'Duplicating…';
      try {
        const r = await fetch('/api/agents/duplicate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Duplicate failed');
        STATE.config = null;
        setTimeout(() => { STATE.controlTab = 'marketplace'; renderControl(container); }, 400);
      } catch (e) {
        alert('Duplicate failed: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Duplicate to local';
      }
    });
  });
}

// Agent detail flyout (TKT-ZAF-0050) — opens from the right and renders the full agent spec
// with inline edit + save, plus Org/team assignment and N+1 (manager) selection.
function openAgentDetailFlyout(key, hostContainer) {
  document.getElementById('zaf-agent-flyout')?.remove();
  const conf = STATE.config || {};
  const a = (conf.agents || {})[key];
  if (!a) return;
  const teams = (conf.org?.teams || []);
  const otherAgentKeys = Object.keys(conf.agents || {}).filter(k => k !== key);
  const harnessOpts = getAllHarnessOptions();
  const cap = REASONING_CAPABILITY[a.harness] || { values: ['low','medium','high'] };
  const reasoningVals = Array.isArray(cap.values) ? cap.values : ['low','medium','high'];
  const currentTeamId = (teams.find(t => (t.members || []).includes(key)) || {}).id || '';

  const html = `
    <div class="zaf-launch-backdrop" id="zaf-agent-flyout-bd"></div>
    <aside class="zaf-agent-flyout-panel" role="dialog" aria-label="Agent ${safeHTML(a.roleName || key)}">
      <header style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border-subtle);">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${safeHTML(a.roleName || key)}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${safeHTML(key)}</div>
        </div>
        <button class="zaf-launch-close" id="zaf-agent-flyout-close" title="Close">✕</button>
      </header>
      <form id="zaf-agent-flyout-form" style="display:flex;flex-direction:column;gap:12px;padding:16px 18px;overflow-y:auto;">
        <div class="zaf-field"><label>Role Name</label>
          <input id="fly-roleName" value="${safeHTML(a.roleName || '')}" />
        </div>
        <div class="zaf-field"><label>System Prompt / Personality</label>
          <textarea id="fly-personality" rows="6" style="resize:vertical">${safeHTML(a.personality || '')}</textarea>
        </div>
        <div class="zaf-field"><label>CLI / Harness</label>
          <select id="fly-harness">
            ${harnessOpts.map(h => `<option value="${h.id}" ${a.harness===h.id?'selected':''}>${h.label}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Model ID</label>
          <input id="fly-modelId" value="${safeHTML(a.modelId || '')}" />
        </div>
        <div class="zaf-field"><label>Reasoning</label>
          <select id="fly-reasoning">
            ${reasoningVals.map(v => `<option value="${v}" ${a.reasoning===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Structural Role</label>
          <select id="fly-structRole">
            ${Object.entries(STRUCTURAL_PERSONAS).map(([id,p]) => `<option value="${id}" ${(a.structuralRole||'worker')===id?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Heartbeat (seconds)</label>
          <input id="fly-heartbeat" type="number" min="5" max="300" step="5" value="${a.heartbeat || 40}" />
        </div>
        <div class="zaf-field"><label>Org Team</label>
          <select id="fly-team">
            <option value="">— unassigned —</option>
            ${teams.map(t => `<option value="${safeHTML(t.id)}" ${currentTeamId===t.id?'selected':''}>${safeHTML(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>N+1 Supervisor</label>
          <select id="fly-manager">
            <option value="">None (reports to operator)</option>
            ${otherAgentKeys.map(k => `<option value="${safeHTML(k)}" ${(a.manager||'')===k?'selected':''}>${safeHTML(conf.agents[k].roleName || k)} (${safeHTML(k)})</option>`).join('')}
          </select>
        </div>
        <div class="zaf-field"><label>Authorized CLIs</label>
          <div id="fly-harness-multi" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--bg-input);border:1px solid var(--border-medium);padding:10px 12px;border-radius:var(--radius-sm);">
            ${harnessOpts.map(h => {
              const isActive = Array.isArray(a.harnesses) && a.harnesses.length
                ? a.harnesses.includes(h.id)
                : (a.harness === h.id);
              return `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                <input type="checkbox" class="fly-harness-cb" value="${h.id}" ${isActive?'checked':''} />
                <span>${h.label}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;padding:6px 0">
          <button type="submit" class="zaf-btn">Save</button>
          <span id="fly-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
      </form>
    </aside>`;

  const wrap = document.createElement('div');
  wrap.id = 'zaf-agent-flyout';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector('#zaf-agent-flyout-close').addEventListener('click', close);
  wrap.querySelector('#zaf-agent-flyout-bd').addEventListener('click', close);

  wrap.querySelector('#zaf-agent-flyout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = wrap.querySelector('#fly-status');
    const harnesses = Array.from(wrap.querySelectorAll('.fly-harness-cb:checked')).map(cb => cb.value);
    const patch = {
      roleName:       wrap.querySelector('#fly-roleName').value.trim(),
      personality:    wrap.querySelector('#fly-personality').value,
      harness:        wrap.querySelector('#fly-harness').value,
      modelId:        wrap.querySelector('#fly-modelId').value.trim(),
      reasoning:      wrap.querySelector('#fly-reasoning').value,
      structuralRole: wrap.querySelector('#fly-structRole').value,
      heartbeat:      +wrap.querySelector('#fly-heartbeat').value || 40,
      manager:        wrap.querySelector('#fly-manager').value || null,
      harnesses:      harnesses.length ? harnesses : undefined,
    };
    const targetTeamId = wrap.querySelector('#fly-team').value;
    statusEl.textContent = 'Saving…';
    try {
      const r = await fetch('/api/agent/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, patch }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      // Team membership change: write via /api/config/save (read current, mutate, send).
      if (STATE.config?.org?.teams) {
        const currentTeam = STATE.config.org.teams.find(t => (t.members||[]).includes(key));
        const moving = (currentTeam?.id || '') !== targetTeamId;
        if (moving) {
          for (const t of STATE.config.org.teams) t.members = (t.members||[]).filter(m => m !== key);
          if (targetTeamId) {
            const target = STATE.config.org.teams.find(t => t.id === targetTeamId);
            if (target) { target.members = target.members || []; target.members.push(key); }
          }
          await fetch('/api/config/save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(STATE.config),
          });
        }
      }
      STATE.config.agents[key] = d.agent || { ...STATE.config.agents[key], ...patch };
      statusEl.textContent = '✓ Saved';
      setTimeout(() => { close(); renderControl(hostContainer); }, 600);
    } catch (err) {
      statusEl.textContent = '✗ ' + err.message;
    }
  });
}

// ---- Skill Library (TKT-ZAF-0038) ----
function renderControlSkills() {
  const repos = (STATE.data?.repos || []).map(r => r.id);
  const selectedRepo = STATE.skillLibRepo || repos[0] || '';
  const repoSelect = repos.map(r => `<option value="${safeHTML(r)}" ${r===selectedRepo?'selected':''}>${safeHTML(r)}</option>`).join('');
  return `
    <div class="zaf-control-card" style="max-width:900px">
      <h2>Skill Library</h2>
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:13px">Saved .zaf-skill.md files for the selected repo. Skills are auto-injected into agent seed prompts (up to 3 most recent).</p>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:20px">
        <label style="font-size:12px;color:var(--text-secondary)">Repo:</label>
        <select id="skill-lib-repo" style="font-size:12px">${repoSelect}</select>
        <button class="console-btn" id="skill-lib-reload">Reload</button>
      </div>
      <div id="skill-lib-list"><div style="color:var(--text-muted);font-size:12px">Loading…</div></div>
    </div>`;
}

function wireSkillLibrary(container) {
  const repoSel  = container.querySelector('#skill-lib-repo');
  const listEl   = container.querySelector('#skill-lib-list');
  const reloadBtn = container.querySelector('#skill-lib-reload');
  if (!repoSel || !listEl) return;

  async function loadSkills() {
    const repo = repoSel.value;
    STATE.skillLibRepo = repo;
    listEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px">Loading…</div>`;
    try {
      const r = await fetch(`/api/repo/skills?repo=${encodeURIComponent(repo)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Load failed');
      if (!d.skills.length) {
        listEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px">No .zaf-skill.md files found in ${safeHTML(repo)}/.zaf-skills/. Extract skills from completed agent runs to populate this library.</div>`;
        return;
      }
      let html = `<div class="mkt-agent-grid">`;
      for (const sk of d.skills) {
        const toolTags = (sk.tools || []).map(t => `<span class="skill-tool-tag">${safeHTML(t)}</span>`).join('');
        const sourceBadge = sk.source === 'extracted' ? `<span class="mkt-badge-imported" style="font-size:10px">extracted</span>` : `<span class="mkt-badge-local" style="font-size:10px">manual</span>`;
        html += `<div class="mkt-agent-card" data-skill-file="${safeHTML(sk.filename)}">
          <div class="mkt-agent-header">
            <span class="mkt-agent-name">${safeHTML(sk.name)}</span>
            ${sourceBadge}
          </div>
          ${sk.description ? `<div class="mkt-agent-excerpt">${safeHTML(sk.description)}</div>` : ''}
          ${toolTags ? `<div class="skill-cand-tools">${toolTags}</div>` : ''}
          ${sk.extractedFrom ? `<div style="font-size:10px;color:var(--text-muted)">from: ${safeHTML(sk.extractedFrom)}</div>` : ''}
          ${sk.created ? `<div style="font-size:10px;color:var(--text-muted)">${safeHTML(sk.created)}</div>` : ''}
          <div class="skill-cand-actions">
            <button class="console-btn skill-edit-btn" data-file="${safeHTML(sk.filename)}" data-repo="${safeHTML(repo)}">Edit</button>
            <button class="console-btn" style="color:var(--status-blocked)" data-delete-file="${safeHTML(sk.filename)}" data-delete-repo="${safeHTML(repo)}">Delete</button>
          </div>
          <div class="skill-edit-area" id="skill-edit-${safeHTML(sk.filename)}" style="display:none;margin-top:8px">
            <textarea class="skill-edit-ta" rows="10" style="width:100%;background:var(--bg-input,#1a1a2e);border:1px solid var(--border-color,#2a2a3e);color:var(--text-primary);font-family:monospace;font-size:11px;padding:8px;border-radius:4px;resize:vertical">${safeHTML(sk.body)}</textarea>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="console-btn skill-save-edit-btn" data-file="${safeHTML(sk.filename)}" data-repo="${safeHTML(repo)}">Save</button>
              <button class="console-btn skill-cancel-edit-btn" data-file="${safeHTML(sk.filename)}">Cancel</button>
            </div>
          </div>
        </div>`;
      }
      html += `</div>`;
      listEl.innerHTML = html;

      // Edit
      listEl.querySelectorAll('.skill-edit-btn').forEach(btn => {
        btn.onclick = () => {
          const area = listEl.querySelector(`#skill-edit-${btn.dataset.file}`);
          if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
        };
      });
      listEl.querySelectorAll('.skill-cancel-edit-btn').forEach(btn => {
        btn.onclick = () => {
          const area = listEl.querySelector(`#skill-edit-${btn.dataset.file}`);
          if (area) area.style.display = 'none';
        };
      });
      listEl.querySelectorAll('.skill-save-edit-btn').forEach(btn => {
        btn.onclick = async () => {
          const area = listEl.querySelector(`#skill-edit-${btn.dataset.file}`);
          const ta = area?.querySelector('.skill-edit-ta');
          if (!ta) return;
          btn.disabled = true;
          btn.textContent = 'Saving…';
          try {
            const sr = await fetch('/api/repo/skill/update', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repo: btn.dataset.repo, filename: btn.dataset.file, content: ta.value }),
            });
            const sd = await sr.json();
            if (!sr.ok) throw new Error(sd.error || 'Save failed');
            btn.textContent = '✓ Saved';
            setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
          } catch (e) {
            alert('Save failed: ' + e.message);
            btn.textContent = 'Save';
            btn.disabled = false;
          }
        };
      });
      // Delete
      listEl.querySelectorAll('[data-delete-file]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm(`Delete skill "${btn.dataset.deleteFile}"? This cannot be undone.`)) return;
          try {
            const dr = await fetch('/api/repo/skill/delete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repo: btn.dataset.deleteRepo, filename: btn.dataset.deleteFile }),
            });
            const dd = await dr.json();
            if (!dr.ok) throw new Error(dd.error || 'Delete failed');
            await loadSkills();
          } catch (e) { alert('Delete failed: ' + e.message); }
        };
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--status-blocked);font-size:12px">Error: ${safeHTML(e.message)}</div>`;
    }
  }

  repoSel.addEventListener('change', loadSkills);
  reloadBtn?.addEventListener('click', loadSkills);
  loadSkills();
}

// ---- Usage / Agent Activity ----
function renderControlUsage() {
  const agentUsage = STATE.config.agentUsage || {};
  const harnessUsage = STATE.config.harnessUsage || {};
  const audit = STATE.audit || [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgo  = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const runsToday = audit.filter(e => e.kind === 'process.spawn' && e.ts && e.ts.startsWith(todayStr)).length;
  const runsWeek  = audit.filter(e => e.kind === 'process.spawn' && e.ts && new Date(e.ts).getTime() >= weekAgo).length;

  const agentRows = Object.entries(agentUsage).map(([role, u]) => {
    const avgDur = u.runs > 0 ? (u.secondsTotal / u.runs).toFixed(1) : '—';
    const lastRun = u.lastRun ? new Date(u.lastRun).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';
    return `<tr>
      <td style="color:var(--text-primary);font-family:monospace">${safeHTML(role)}</td>
      <td style="color:var(--text-muted)">${safeHTML(u.harness || '—')}</td>
      <td style="color:var(--text-secondary)">${u.runs}</td>
      <td style="color:var(--text-secondary)">${avgDur}s</td>
      <td style="color:var(--text-muted);font-size:10px">${lastRun}</td>
    </tr>`;
  }).join('');

  const harnessRows = Object.entries(harnessUsage).map(([h, u]) => {
    const rate = u.runs > 0 ? ((u.successes / u.runs) * 100).toFixed(0) : '—';
    return `<tr>
      <td style="color:var(--text-primary);font-family:monospace">${safeHTML(h)}</td>
      <td style="color:var(--text-secondary)">${u.runs}</td>
      <td style="color:${rate >= 80 ? 'var(--green-400)' : rate >= 50 ? 'var(--amber-400)' : 'var(--red-400)'}">${rate}%</td>
    </tr>`;
  }).join('');

  return `
    <div class="zaf-control-grid">
      <div class="zaf-control-card">
        <h2>Agent Activity</h2>
        <div style="display:flex;gap:32px;margin-bottom:18px">
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:700;color:var(--indigo-400)">${runsToday}</div>
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Runs Today</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:700;color:var(--indigo-400)">${runsWeek}</div>
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Runs This Week</div>
          </div>
        </div>
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:8px">Per Agent Role</h3>
        ${agentRows ? `<table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="color:var(--text-muted);font-size:10px">
            <th style="text-align:left;padding:4px 6px">Role</th>
            <th style="text-align:left;padding:4px 6px">Harness</th>
            <th style="text-align:left;padding:4px 6px">Runs</th>
            <th style="text-align:left;padding:4px 6px">Avg Dur</th>
            <th style="text-align:left;padding:4px 6px">Last Run</th>
          </tr></thead>
          <tbody>${agentRows}</tbody>
        </table>` : '<div style="color:var(--text-muted);font-size:11px">No agent runs recorded yet.</div>'}
      </div>
      <div class="zaf-control-card">
        <h2>Per-Harness Success Rate</h2>
        ${harnessRows ? `<table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="color:var(--text-muted);font-size:10px">
            <th style="text-align:left;padding:4px 6px">Harness</th>
            <th style="text-align:left;padding:4px 6px">Runs</th>
            <th style="text-align:left;padding:4px 6px">Success Rate</th>
          </tr></thead>
          <tbody>${harnessRows}</tbody>
        </table>` : '<div style="color:var(--text-muted);font-size:11px">No harness data yet. Runs will populate this automatically.</div>'}
      </div>
    </div>`;
}

// =========================================================================
// CONTROL: CLI Hub (TKT-ZAF-0019)
// =========================================================================

const CLI_HUB_HARNESSES = [
  { id: 'claude-code', label: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code', authCmd: 'npx -y @anthropic-ai/claude-code' },
  { id: 'codex',       label: 'Codex',       installCmd: 'npm install -g @openai/codex',            authCmd: 'npx -y @openai/codex' },
  { id: 'antigravity', label: 'Antigravity', installCmd: 'npm install -g @google/antigravity',      authCmd: 'npx -y @google/antigravity' },
  { id: 'aider',       label: 'Aider',       installCmd: 'pipx install aider-chat',                  authCmd: 'aider' },
  { id: 'goose',       label: 'Goose',       installCmd: 'pipx install goose-ai',                    authCmd: 'goose' },
  { id: 'amp',         label: 'Amp',         installCmd: 'npm install -g @sourcegraph/amp',          authCmd: 'npx -y @sourcegraph/amp' },
];

function getCliHarnessSpec(id) {
  const custom = (STATE.config?.customHarnesses || []).find(h => h.id === id);
  if (custom) return { id: custom.id, label: custom.displayName, installCmd: custom.installCmd, authCmd: custom.authCmd };
  return CLI_HUB_HARNESSES.find(h => h.id === id);
}

function renderControlCliHub() {
  const conf = STATE.config || {};
  const customHarnesses = conf.customHarnesses || [];
  const agentUsage = conf.agentUsage || {};
  const github = conf.github || {};

  const allHarnesses = [
    ...CLI_HUB_HARNESSES,
    ...customHarnesses.map(h => ({ id: h.id, label: h.displayName, installCmd: h.installCmd || '', authCmd: h.authCmd || '', isCustom: true })),
  ];

  const cardsHtml = allHarnesses.map(h => {
    const usage = agentUsage[h.id] || {};
    const lastRun = usage.lastRun ? new Date(usage.lastRun).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Never';
    const statusInfo = STATE.cliHubStatus[h.id];
    const connected = STATE.cliHubConnected[h.id];

    let installBadge, installBadgeClass;
    if (statusInfo === undefined) {
      installBadge = '⋯ Checking…'; installBadgeClass = 'checking';
    } else if (statusInfo.installed) {
      installBadge = `✓ ${safeHTML(statusInfo.version || 'Installed')}`; installBadgeClass = 'installed';
    } else {
      installBadge = '✗ Not installed'; installBadgeClass = 'not-installed';
    }

    return `
      <div class="zaf-cli-card" id="cli-card-${h.id}" data-harness-id="${h.id}">
        <div class="cli-card-header">
          <span class="cli-card-name">${safeHTML(h.label)}</span>
          <div class="cli-card-badges">
            <span class="cli-status-badge ${installBadgeClass}" id="cli-badge-install-${h.id}">${installBadge}</span>
            <span class="cli-status-badge ${connected ? 'auth-connected' : 'auth-unknown'}" id="cli-badge-auth-${h.id}">${connected ? `Connected ✓ ${safeHTML(connected)}` : 'Auth: Unknown'}</span>
          </div>
        </div>
        <div class="cli-card-last-run">Last run: ${safeHTML(lastRun)}</div>
        <div class="cli-security-warning">⚠ Only install from verified sources. ZAF does not audit packages.</div>
        <div class="cli-install-row">
          <input class="cli-install-cmd-input" id="cli-install-cmd-${h.id}" value="${safeHTML(h.installCmd)}" placeholder="Install command…" />
          <button class="zaf-btn" id="cli-install-btn-${h.id}" data-harness="${h.id}">Install</button>
        </div>
        <div class="cli-pty-host-wrap" id="cli-pty-install-wrap-${h.id}" style="display:none;margin-top:8px;">
          <div id="cli-pty-install-${h.id}" style="height:220px;background:#0a0a0f;border-radius:4px;overflow:hidden;"></div>
        </div>
        <div class="cli-connect-row">
          <button class="zaf-btn secondary" id="cli-connect-btn-${h.id}" data-harness="${h.id}">Connect / Auth</button>
        </div>
        <div class="cli-cred-note">Credentials stored unencrypted by CLI (~/.claude etc). Never read by ZAF.</div>
        <div class="cli-pty-host-wrap" id="cli-pty-connect-wrap-${h.id}" style="display:none;margin-top:8px;">
          <div id="cli-pty-connect-${h.id}" style="height:220px;background:#0a0a0f;border-radius:4px;overflow:hidden;"></div>
        </div>
      </div>`;
  }).join('');

  const githubHtml = `
    <div class="zaf-control-card" style="margin-top:24px">
      <h2>Git Identity &amp; Remote</h2>
      <form id="zaf-github-form" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="zaf-field"><label>Git Name</label>
          <input id="gh-name" value="${safeHTML(github.name || '')}" placeholder="Nassau-1" />
        </div>
        <div class="zaf-field"><label>Git Email</label>
          <input id="gh-email" type="email" value="${safeHTML(github.email || '')}" placeholder="you@example.com" />
        </div>
        <div class="zaf-field"><label>Default Remote</label>
          <input id="gh-remote" value="${safeHTML(github.defaultRemote || 'origin')}" />
        </div>
        <div class="zaf-field"><label>Auth Method</label>
          <select id="gh-auth-method">
            <option value="ssh" ${github.authMethod === 'ssh' ? 'selected' : ''}>SSH Key</option>
            <option value="pat" ${github.authMethod === 'pat' ? 'selected' : ''}>Personal Access Token (PAT)</option>
          </select>
        </div>
        <div class="zaf-field" id="gh-ssh-row" style="${github.authMethod === 'pat' ? 'display:none' : ''}">
          <label>SSH Key Path</label>
          <input id="gh-ssh-path" value="${safeHTML(github.sshKeyPath || '')}" placeholder="~/.ssh/id_ed25519" />
        </div>
        <div class="zaf-field" id="gh-pat-row" style="${github.authMethod !== 'pat' ? 'display:none' : ''}">
          <label>Personal Access Token</label>
          <input id="gh-pat" type="password" value="" placeholder="${github.pat ? '••••• (stored, enter new to replace)' : 'ghp_…'}" />
        </div>
        <div style="grid-column:1/3;display:flex;align-items:center;gap:12px;">
          <button type="submit" class="zaf-btn">Save Git Config</button>
          <span id="gh-save-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
      </form>
    </div>`;

  const addCustomHtml = `
    <div class="zaf-control-card" style="margin-top:24px">
      <h2>Add Custom Harness</h2>
      <form id="zaf-custom-harness-form" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="zaf-field"><label>Display Name</label><input id="ch-name" required placeholder="My CLI" /></div>
        <div class="zaf-field"><label>Version Check Command</label><input id="ch-version-cmd" required placeholder="mycli --version" /></div>
        <div class="zaf-field" style="grid-column:1/3"><label>Install Command</label><input id="ch-install-cmd" placeholder="npm install -g mycli" /></div>
        <div class="zaf-field" style="grid-column:1/3"><label>Auth Command (optional)</label><input id="ch-auth-cmd" placeholder="mycli auth login" /></div>
        <div class="zaf-field" style="grid-column:1/3"><label>Default Model IDs (comma-separated)</label><input id="ch-model-ids" placeholder="gpt-4o, claude-sonnet-4-6" /></div>
        <div style="grid-column:1/3;display:flex;align-items:center;gap:12px;">
          <button type="submit" class="zaf-btn">Add Harness</button>
          <span id="ch-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
      </form>
    </div>`;

  return `
    <div class="zaf-cli-hub fade-in">
      <div class="zaf-cli-hub-header">
        <div class="zaf-overview-title"><div class="accent-bar"></div>CLI Hub</div>
        <div class="zaf-overview-sub">Install, authenticate, and configure CLI harnesses for agent runs.</div>
      </div>
      <div class="zaf-cli-grid">${cardsHtml}</div>
      ${githubHtml}
      ${addCustomHtml}
    </div>`;
}

function wireCliHub(container) {
  const conf = STATE.config || {};
  const customHarnesses = conf.customHarnesses || [];
  const allIds = [...CLI_HUB_HARNESSES.map(h => h.id), ...customHarnesses.map(h => h.id)];

  // Kick off status checks for harnesses not yet checked
  for (const id of allIds) {
    if (STATE.cliHubStatus[id] === undefined) {
      STATE.cliHubStatus[id] = null; // mark as in-flight
      fetch(`/api/cli/status?harness=${encodeURIComponent(id)}`)
        .then(r => r.json())
        .then(data => {
          STATE.cliHubStatus[id] = data;
          const badge = document.getElementById(`cli-badge-install-${id}`);
          if (badge) {
            badge.textContent = data.installed ? `✓ ${data.version || 'Installed'}` : '✗ Not installed';
            badge.className = `cli-status-badge ${data.installed ? 'installed' : 'not-installed'}`;
          }
        })
        .catch(() => {
          STATE.cliHubStatus[id] = { installed: false };
          const badge = document.getElementById(`cli-badge-install-${id}`);
          if (badge) { badge.textContent = '✗ Not installed'; badge.className = 'cli-status-badge not-installed'; }
        });
    }
  }

  // Install buttons
  container.querySelectorAll('[id^="cli-install-btn-"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const harnessId = btn.dataset.harness;
      const cmdInput = document.getElementById(`cli-install-cmd-${harnessId}`);
      const rawCmd = cmdInput?.value?.trim() || '';
      if (!rawCmd) return;
      const tokens = rawCmd.split(/\s+/);
      const [cmd, ...args] = tokens;
      const wrapEl = document.getElementById(`cli-pty-install-wrap-${harnessId}`);
      if (wrapEl) wrapEl.style.display = 'block';
      btn.disabled = true; btn.textContent = 'Installing…';
      try {
        const r = await fetch('/api/pty/inline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, args, label: `Install ${harnessId}`, harnessId, kind: 'cli-hub-install' }),
        });
        const data = await r.json();
        if (data.processId) {
          STATE.cliHubProcesses.set(data.processId, { harnessId, kind: 'install' });
          const hostEl = document.getElementById(`cli-pty-install-${harnessId}`);
          if (hostEl) initXtermInElement(data.processId, hostEl);
        } else {
          btn.disabled = false; btn.textContent = 'Install';
        }
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Install';
        alert('Failed to spawn install: ' + err.message);
      }
    });
  });

  // Connect buttons
  container.querySelectorAll('[id^="cli-connect-btn-"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const harnessId = btn.dataset.harness;
      const spec = getCliHarnessSpec(harnessId);
      if (!spec?.authCmd) { alert('No auth command configured for ' + harnessId); return; }
      const tokens = spec.authCmd.split(/\s+/);
      const [cmd, ...args] = tokens;
      const wrapEl = document.getElementById(`cli-pty-connect-wrap-${harnessId}`);
      if (wrapEl) wrapEl.style.display = 'block';
      btn.disabled = true; btn.textContent = 'Authenticating…';
      try {
        const r = await fetch('/api/pty/inline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, args, label: `Connect ${harnessId}`, harnessId, kind: 'cli-hub-connect' }),
        });
        const data = await r.json();
        if (data.processId) {
          STATE.cliHubProcesses.set(data.processId, { harnessId, kind: 'connect' });
          const hostEl = document.getElementById(`cli-pty-connect-${harnessId}`);
          if (hostEl) initXtermInElement(data.processId, hostEl);
        } else {
          btn.disabled = false; btn.textContent = 'Connect / Auth';
        }
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Connect / Auth';
        alert('Failed to spawn connect: ' + err.message);
      }
    });
  });

  // GitHub form
  container.querySelector('#zaf-github-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = container.querySelector('#gh-name').value.trim();
    const email = container.querySelector('#gh-email').value.trim();
    const defaultRemote = container.querySelector('#gh-remote').value.trim();
    const authMethod = container.querySelector('#gh-auth-method').value;
    const sshKeyPath = container.querySelector('#gh-ssh-path')?.value.trim() || '';
    const pat = container.querySelector('#gh-pat')?.value || '';
    const statusEl = container.querySelector('#gh-save-status');
    statusEl.textContent = 'Saving…';
    try {
      const r = await fetch('/api/config/github', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, defaultRemote, authMethod, sshKeyPath, ...(pat ? { pat } : {}) }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      statusEl.textContent = '✓ Saved — git config updated';
      STATE.config = STATE.config || {};
      STATE.config.github = STATE.config.github || {};
      if (name)          STATE.config.github.name = name;
      if (email)         STATE.config.github.email = email;
      if (defaultRemote) STATE.config.github.defaultRemote = defaultRemote;
      if (authMethod)    STATE.config.github.authMethod = authMethod;
      if (sshKeyPath)    STATE.config.github.sshKeyPath = sshKeyPath;
      if (pat)           STATE.config.github.pat = '•stored•';
      const patInput = container.querySelector('#gh-pat');
      if (patInput) patInput.value = '';
    } catch (err) {
      statusEl.textContent = '✗ Failed: ' + err.message;
    }
  });

  container.querySelector('#gh-auth-method')?.addEventListener('change', (e) => {
    const sshRow = container.querySelector('#gh-ssh-row');
    const patRow = container.querySelector('#gh-pat-row');
    if (sshRow) sshRow.style.display = e.target.value === 'ssh' ? '' : 'none';
    if (patRow) patRow.style.display = e.target.value === 'pat' ? '' : 'none';
  });

  // Custom harness form
  container.querySelector('#zaf-custom-harness-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = container.querySelector('#ch-name').value.trim();
    const versionCmd = container.querySelector('#ch-version-cmd').value.trim();
    const installCmd = container.querySelector('#ch-install-cmd').value.trim();
    const authCmd = container.querySelector('#ch-auth-cmd').value.trim();
    const modelIds = container.querySelector('#ch-model-ids').value.trim();
    const statusEl = container.querySelector('#ch-status');
    statusEl.textContent = 'Saving…';
    try {
      const r = await fetch('/api/harness/custom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, versionCmd, installCmd, authCmd, modelIds }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      statusEl.textContent = `✓ Added harness "${safeHTML(displayName)}" (${data.id})`;
      const cr = await fetch('/api/config');
      if (cr.ok) STATE.config = await cr.json();
      const controlEl = document.getElementById('content');
      if (controlEl && STATE.currentView === 'control') renderControl(controlEl);
    } catch (err) {
      statusEl.textContent = '✗ Failed: ' + err.message;
    }
  });
}

// =========================================================================
// VIEW: ORG / TEAM BUILDER (drag-and-drop SVG)
// =========================================================================

function renderOrg(container) {
  if (!STATE.config) {
    container.innerHTML = `<div style="padding:40px;color:var(--text-muted)">Loading config…</div>`;
    fetch('/api/config').then(r => r.json()).then(c => { STATE.config = c; renderOrg(container); }).catch(() => {});
    return;
  }

  STATE.config.org = STATE.config.org || { name:'Org', teams: [] };
  STATE.config.org.teams = STATE.config.org.teams || [];
  // Per-team position state (kept in config so it persists)
  STATE.config.org.layout = STATE.config.org.layout || {};

  container.innerHTML = `
    <div class="zaf-org-wrap fade-in">
      <div class="zaf-org-canvas-wrap">
        <div class="zaf-org-toolbar">
          <button class="zaf-btn" id="org-add-team">+ Team</button>
          <button class="zaf-btn secondary" id="org-add-agent">+ Agent</button>
          <button class="zaf-btn secondary" id="org-fit">Fit</button>
          <button class="zaf-btn secondary" id="org-save">Save Layout</button>
        </div>
        <svg class="zaf-org-canvas" id="org-canvas" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="zaf-org-help">
          Drag team boxes to reposition · Drag agent chips between teams to reassign · Click to select & edit on the right.
        </div>
      </div>
      <div class="zaf-org-side" id="org-side">
        <h3>Inspector</h3>
        <div id="org-inspector"><div style="color:var(--text-muted);font-size:11px">Select a team or agent to edit.</div></div>
      </div>
    </div>`;

  drawOrgCanvas();
  bindOrgInteractions(container);
}

function drawOrgCanvas() {
  const svg = document.getElementById('org-canvas');
  if (!svg) return;
  const org = STATE.config.org;
  const agents = STATE.config.agents || {};
  const teams = org.teams;
  const layout = org.layout;

  // Initial layout: tile teams that lack coords
  const TEAM_W = 280, TEAM_H = 240, MARGIN_X = 320, MARGIN_Y = 280;
  teams.forEach((t, i) => {
    if (!layout[t.id]) {
      const col = i % 4, row = Math.floor(i/4);
      layout[t.id] = { x: 60 + col*MARGIN_X, y: 60 + row*MARGIN_Y };
    }
  });

  // Edges: team parent + supervisor (agent->manager)
  let edgesHtml = '';
  for (const t of teams) {
    if (t.parent) {
      const parent = teams.find(x => x.id === t.parent);
      if (parent) {
        const a = layout[t.parent], b = layout[t.id];
        if (a && b) {
          const x1 = a.x + TEAM_W/2, y1 = a.y + TEAM_H;
          const x2 = b.x + TEAM_W/2, y2 = b.y;
          const my = (y1+y2)/2;
          edgesHtml += `<path class="org-team-edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" />`;
        }
      }
    }
  }
  // Supervisor edges between agents
  const agentPos = {};
  for (const team of teams) {
    const tl = layout[team.id];
    if (!tl) continue;
    const members = team.members || [];
    members.forEach((m, i) => {
      agentPos[m] = { x: tl.x + 12, y: tl.y + 56 + i*32, w: TEAM_W - 24, h: 26 };
    });
  }
  for (const [agentKey, agent] of Object.entries(agents)) {
    if (agent.manager && agentPos[agentKey] && agentPos[agent.manager]) {
      const a = agentPos[agent.manager];
      const b = agentPos[agentKey];
      const x1 = a.x + a.w, y1 = a.y + a.h/2;
      const x2 = b.x,      y2 = b.y + b.h/2;
      const mx = (x1+x2)/2;
      edgesHtml += `<path class="org-supervisor-edge" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" />`;
    }
  }

  // Team boxes + agent chips
  let nodesHtml = '';
  for (const team of teams) {
    const tl = layout[team.id];
    if (!tl) continue;
    const isSelected = STATE.selectedOrgTeamId === team.id;
    nodesHtml += `
      <g class="org-team-group" data-team-id="${team.id}" transform="translate(${tl.x},${tl.y})">
        <rect class="org-team-box ${isSelected?'selected':''}" rx="8" width="${TEAM_W}" height="${TEAM_H}" />
        <text class="org-team-label" x="14" y="22">${safeHTML(team.name)}</text>
        <text class="org-team-sub"   x="14" y="38">${(team.members||[]).length} member${(team.members||[]).length===1?'':'s'}${team.parent?` · ↳ ${safeHTML(team.parent)}`:''}</text>
        ${(team.members||[]).map((m, i) => {
          const a = agents[m];
          if (!a) return '';
          const ax = 12, ay = 56 + i*32, aw = TEAM_W - 24, ah = 26;
          const roleClass = `role-${a.structuralRole || 'worker'}`;
          const isAgentSelected = STATE.selectedOrgAgentKey === m;
          const persona = STRUCTURAL_PERSONAS[a.structuralRole] || STRUCTURAL_PERSONAS.worker;
          return `
            <g class="org-agent-node" data-agent-key="${m}" data-team-id="${team.id}" transform="translate(${ax},${ay})">
              <rect class="org-agent-rect ${roleClass} ${isAgentSelected?'selected':''}" width="${aw}" height="${ah}" rx="4" />
              <text class="org-agent-name" x="8" y="12">${safeHTML(a.roleName)}</text>
              <text class="org-agent-role-tag" x="8" y="22">${persona.icon} · ${m}${a.manager?` · ↑ ${a.manager}`:''}</text>
            </g>`;
        }).join('')}
      </g>`;
  }

  svg.innerHTML = edgesHtml + nodesHtml;
}

function bindOrgInteractions(container) {
  const svg = document.getElementById('org-canvas');
  if (!svg) return;

  let dragging = null;        // { type:'team'|'agent', id, startX, startY, origX, origY }
  let pointerOriginX = 0, pointerOriginY = 0;

  function clientToSVG(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  svg.addEventListener('mousedown', (e) => {
    const teamGroup = e.target.closest('.org-team-group');
    const agentNode = e.target.closest('.org-agent-node');
    if (agentNode) {
      const agentKey = agentNode.dataset.agentKey;
      const teamId   = agentNode.dataset.teamId;
      STATE.selectedOrgAgentKey = agentKey;
      STATE.selectedOrgTeamId = null;
      renderOrgInspector();
      const pt = clientToSVG(e.clientX, e.clientY);
      const transform = agentNode.transform.baseVal[0].matrix;
      dragging = { type:'agent', id: agentKey, origTeamId: teamId, startX: pt.x, startY: pt.y, origX: transform.e, origY: transform.f, el: agentNode };
      e.stopPropagation(); return;
    }
    if (teamGroup) {
      const id = teamGroup.dataset.teamId;
      STATE.selectedOrgTeamId = id;
      STATE.selectedOrgAgentKey = null;
      renderOrgInspector();
      const pt = clientToSVG(e.clientX, e.clientY);
      const layout = STATE.config.org.layout[id];
      dragging = { type:'team', id, startX: pt.x, startY: pt.y, origX: layout.x, origY: layout.y, el: teamGroup };
      return;
    }
    STATE.selectedOrgTeamId = null;
    STATE.selectedOrgAgentKey = null;
    drawOrgCanvas();
    renderOrgInspector();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const pt = clientToSVG(e.clientX, e.clientY);
    const dx = pt.x - dragging.startX;
    const dy = pt.y - dragging.startY;
    if (dragging.type === 'team') {
      const layout = STATE.config.org.layout[dragging.id];
      layout.x = dragging.origX + dx;
      layout.y = dragging.origY + dy;
      drawOrgCanvas();
    } else if (dragging.type === 'agent') {
      const nx = dragging.origX + dx;
      const ny = dragging.origY + dy;
      dragging.el.setAttribute('transform', `translate(${nx},${ny})`);
    }
  });

  window.addEventListener('mouseup', async (e) => {
    if (!dragging) return;
    if (dragging.type === 'agent') {
      // Reassign? Check whether mouse is over another team box
      const pt = clientToSVG(e.clientX, e.clientY);
      const teams = STATE.config.org.teams;
      let targetTeamId = null;
      for (const t of teams) {
        const l = STATE.config.org.layout[t.id];
        if (!l) continue;
        if (pt.x >= l.x && pt.x <= l.x + 280 && pt.y >= l.y && pt.y <= l.y + 240) {
          targetTeamId = t.id; break;
        }
      }
      if (targetTeamId && targetTeamId !== dragging.origTeamId) {
        const fromTeam = teams.find(t => t.id === dragging.origTeamId);
        const toTeam   = teams.find(t => t.id === targetTeamId);
        if (fromTeam && toTeam) {
          fromTeam.members = (fromTeam.members||[]).filter(m => m !== dragging.id);
          toTeam.members   = (toTeam.members||[]).concat(dragging.id);
          await persistConfig();
        }
      }
      drawOrgCanvas();
    }
    dragging = null;
  });

  document.getElementById('org-add-team').addEventListener('click', async () => {
    const name = prompt('Team display name?'); if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (STATE.config.org.teams.find(t => t.id === id)) return alert('Team id already exists');
    STATE.config.org.teams.push({ id, name, parent: null, members: [] });
    await persistConfig();
    renderOrg(document.getElementById('content'));
  });
  document.getElementById('org-add-agent').addEventListener('click', () => openOrgAgentPicker());
  document.getElementById('org-fit').addEventListener('click', () => {
    // Re-tile layout
    STATE.config.org.layout = {};
    drawOrgCanvas();
  });
  document.getElementById('org-save').addEventListener('click', async () => {
    await persistConfig();
    alert('Org layout saved');
  });

  renderOrgInspector();
}

// Org Builder agent picker (TKT-ZAF-0052) — replaces blank-slot "+ Agent" with a searchable
// modal listing every existing agent (Builder + Marketplace), filterable by structural role,
// CLI, and source (local vs imported). Includes a "Create new" fallback for when no existing
// agent fits.
function openOrgAgentPicker() {
  document.getElementById('zaf-org-picker')?.remove();
  const conf = STATE.config || {};
  const agents = Object.entries(conf.agents || {});
  const teams = (conf.org?.teams || []);
  const memberships = {}; // agentKey -> Set of teamIds already in
  for (const t of teams) for (const m of (t.members || [])) {
    if (!memberships[m]) memberships[m] = new Set();
    memberships[m].add(t.id);
  }

  const harnesses = [...new Set(agents.map(([,a]) => a.harness).filter(Boolean))];
  const structRoles = [...new Set(agents.map(([,a]) => a.structuralRole).filter(Boolean))];

  const modal = document.createElement('div');
  modal.id = 'zaf-org-picker';
  modal.className = 'zaf-launch-modal';
  modal.innerHTML = `
    <div class="zaf-launch-backdrop"></div>
    <div class="zaf-launch-panel" style="max-width:760px;width:90vw">
      <div class="zaf-launch-header">
        <div>
          <div class="zaf-launch-title">Pick an agent</div>
          <div class="zaf-launch-sub">Add an existing agent to the org, or create a new one.</div>
        </div>
        <button class="zaf-launch-close" id="org-picker-close" title="Close">✕</button>
      </div>
      <div class="zaf-launch-body" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px">
          <input id="org-picker-q" placeholder="Search by name or key…" />
          <select id="org-picker-cli">
            <option value="">All CLIs</option>
            ${harnesses.map(h => `<option value="${safeHTML(h)}">${safeHTML(h)}</option>`).join('')}
          </select>
          <select id="org-picker-struct">
            <option value="">All roles</option>
            ${structRoles.map(r => `<option value="${safeHTML(r)}">${safeHTML(r)}</option>`).join('')}
          </select>
          <select id="org-picker-source">
            <option value="">Any source</option>
            <option value="local">Local (Builder)</option>
            <option value="imported">Imported (Marketplace)</option>
          </select>
        </div>
        <select id="org-picker-team" style="margin-top:4px">
          ${teams.map(t => `<option value="${safeHTML(t.id)}">${safeHTML(t.name)}</option>`).join('') || '<option value="">— no teams yet, will create Default —</option>'}
        </select>
        <div id="org-picker-list" style="max-height:46vh;overflow:auto;border:1px solid var(--border-subtle);border-radius:4px"></div>
        <div style="display:flex;gap:8px;align-items:center;padding-top:4px">
          <button class="zaf-btn secondary" id="org-picker-create">+ Create new agent…</button>
          <span style="font-size:11px;color:var(--text-muted)">Opens the legacy prompt flow.</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const listEl   = modal.querySelector('#org-picker-list');
  const qEl      = modal.querySelector('#org-picker-q');
  const cliEl    = modal.querySelector('#org-picker-cli');
  const structEl = modal.querySelector('#org-picker-struct');
  const srcEl    = modal.querySelector('#org-picker-source');
  const teamEl   = modal.querySelector('#org-picker-team');

  const renderList = () => {
    const q = (qEl.value || '').toLowerCase();
    const cli = cliEl.value;
    const sr  = structEl.value;
    const src = srcEl.value;
    const rows = agents.filter(([key, a]) => {
      if (cli && a.harness !== cli) return false;
      if (sr && a.structuralRole !== sr) return false;
      if (src === 'local' && a.source) return false;
      if (src === 'imported' && !a.source) return false;
      if (q && !`${a.roleName || ''} ${key}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (!rows.length) {
      listEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:18px;text-align:center">No agents match.</div>`;
      return;
    }
    listEl.innerHTML = rows.map(([key, a]) => {
      const teamId = teamEl.value;
      const inTeam = memberships[key]?.has(teamId);
      return `<div class="mkt-agent-card" style="margin:8px;cursor:pointer" data-key="${safeHTML(key)}">
        <div class="mkt-agent-header">
          <span class="mkt-agent-name">${safeHTML(a.roleName || key)}</span>
          <span class="mkt-agent-key">${safeHTML(key)}</span>
          ${a.source ? '<span class="mkt-badge-imported">imported</span>' : '<span class="mkt-badge-local">local</span>'}
          ${inTeam ? '<span class="mkt-badge-imported" style="margin-left:auto">already in team</span>' : ''}
        </div>
        <div class="mkt-agent-meta">
          <span>${safeHTML(a.harness || '—')}</span>
          <span>${safeHTML(a.structuralRole || 'worker')}</span>
          <span>${safeHTML(a.modelId || a.model || '—')}</span>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.mkt-agent-card').forEach(card => {
      card.addEventListener('click', async () => {
        const key = card.dataset.key;
        let teamId = teamEl.value;
        if (!teams.length) {
          STATE.config.org.teams.push({ id:'default', name:'Default Team', parent:null, members:[] });
          teamId = 'default';
        }
        const target = STATE.config.org.teams.find(t => t.id === teamId);
        if (!target) return;
        target.members = target.members || [];
        if (target.members.includes(key)) { modal.remove(); return; }
        target.members.push(key);
        await persistConfig();
        modal.remove();
        renderOrg(document.getElementById('content'));
      });
    });
  };

  qEl.addEventListener('input', renderList);
  cliEl.addEventListener('change', renderList);
  structEl.addEventListener('change', renderList);
  srcEl.addEventListener('change', renderList);
  teamEl.addEventListener('change', renderList);
  modal.querySelector('#org-picker-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.zaf-launch-backdrop').addEventListener('click', () => modal.remove());
  modal.querySelector('#org-picker-create').addEventListener('click', async () => {
    const key = prompt('Unique agent key (lowercase, no spaces)?'); if (!key) return;
    if (STATE.config.agents[key]) return alert('Agent key exists');
    const roleName = prompt('Role name?'); if (!roleName) return;
    STATE.config.agents[key] = {
      roleName, model: 'normal', customModel: '', reasoning: 'medium',
      heartbeat: 40, harness: 'claude-code', structuralRole: 'worker',
      manager: null, tools: ['FileSystem'],
    };
    let teamId = teamEl.value;
    if (!STATE.config.org.teams.length) {
      STATE.config.org.teams.push({ id:'default', name:'Default Team', parent:null, members:[] });
      teamId = 'default';
    }
    const target = STATE.config.org.teams.find(t => t.id === teamId) || STATE.config.org.teams[0];
    target.members.push(key);
    await persistConfig();
    modal.remove();
    renderOrg(document.getElementById('content'));
  });

  renderList();
}

function renderOrgInspector() {
  const el = document.getElementById('org-inspector');
  if (!el) return;
  if (STATE.selectedOrgTeamId) {
    const t = STATE.config.org.teams.find(x => x.id === STATE.selectedOrgTeamId);
    if (!t) { el.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Selection cleared.</div>'; return; }
    const teams = STATE.config.org.teams;
    el.innerHTML = `
      <div class="meta-field"><label>Team ID</label><input value="${safeHTML(t.id)}" disabled /></div>
      <div class="meta-field"><label>Display name</label><input id="team-name" value="${safeHTML(t.name)}" /></div>
      <div class="meta-field"><label>Parent team</label>
        <select id="team-parent">
          <option value="">None (root)</option>
          ${teams.filter(x => x.id !== t.id).map(x => `<option value="${x.id}" ${t.parent===x.id?'selected':''}>${x.name}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Members (${(t.members||[]).length}): ${(t.members||[]).join(', ') || '<em>none</em>'}</div>
      <div style="display:flex; gap:6px; margin-top:6px;">
        <button class="zaf-btn" id="team-save">Save</button>
        <button class="zaf-btn danger" id="team-delete">Delete</button>
      </div>`;
    document.getElementById('team-save').addEventListener('click', async () => {
      t.name = document.getElementById('team-name').value;
      t.parent = document.getElementById('team-parent').value || null;
      await persistConfig();
      drawOrgCanvas();
    });
    document.getElementById('team-delete').addEventListener('click', async () => {
      if (!confirm('Delete team ' + t.name + '? Members are orphaned (kept in agents map).')) return;
      STATE.config.org.teams = STATE.config.org.teams.filter(x => x.id !== t.id);
      STATE.config.org.teams.forEach(x => { if (x.parent === t.id) x.parent = null; });
      delete STATE.config.org.layout[t.id];
      STATE.selectedOrgTeamId = null;
      await persistConfig();
      renderOrg(document.getElementById('content'));
    });
  } else if (STATE.selectedOrgAgentKey) {
    const k = STATE.selectedOrgAgentKey;
    const a = STATE.config.agents[k];
    if (!a) { el.innerHTML = ''; return; }
    const teams = STATE.config.org.teams;
    const keys = Object.keys(STATE.config.agents);
    el.innerHTML = `
      <div style="font-size:10px;color:var(--text-muted)">Agent <strong style="color:var(--text-primary)">${k}</strong></div>
      <div class="meta-field"><label>Role name</label><input id="ag-name" value="${safeHTML(a.roleName)}" /></div>
      <div class="meta-field"><label>Structural role</label>
        <select id="ag-struct">${Object.entries(STRUCTURAL_PERSONAS).map(([id,p])=>`<option value="${id}" ${a.structuralRole===id?'selected':''}>${p.label}</option>`).join('')}</select>
      </div>
      <div class="meta-field"><label>Supervisor (N+1)</label>
        <select id="ag-mgr">
          <option value="">None</option>
          ${keys.filter(x => x !== k).map(x => `<option value="${x}" ${a.manager===x?'selected':''}>${STATE.config.agents[x].roleName} (${x})</option>`).join('')}
        </select>
      </div>
      <div class="meta-field"><label>Team membership</label>
        <select id="ag-team">
          ${teams.map(t => `<option value="${t.id}" ${(t.members||[]).includes(k)?'selected':''}>${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="zaf-persona-preview" id="ag-persona"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <button class="zaf-btn" id="ag-save">Save</button>
        <button class="zaf-btn danger" id="ag-delete">Delete</button>
      </div>`;
    const upd = () => {
      const id = document.getElementById('ag-struct').value;
      const p = STRUCTURAL_PERSONAS[id];
      document.getElementById('ag-persona').textContent =
`PERSONA — ${p.label}

${p.persona}

BOUNDS:
${p.bounds}`;
    };
    document.getElementById('ag-struct').addEventListener('change', upd);
    upd();

    document.getElementById('ag-save').addEventListener('click', async () => {
      a.roleName = document.getElementById('ag-name').value;
      a.structuralRole = document.getElementById('ag-struct').value;
      a.manager = document.getElementById('ag-mgr').value || null;
      const targetTeam = document.getElementById('ag-team').value;
      for (const t of teams) {
        t.members = (t.members||[]).filter(m => m !== k);
      }
      const tt = teams.find(x => x.id === targetTeam);
      if (tt) tt.members.push(k);
      await persistConfig();
      drawOrgCanvas();
    });
    document.getElementById('ag-delete').addEventListener('click', async () => {
      if (!confirm('Delete agent ' + k + '? This removes it from agents and all teams.')) return;
      delete STATE.config.agents[k];
      for (const t of teams) t.members = (t.members||[]).filter(m => m !== k);
      STATE.selectedOrgAgentKey = null;
      await persistConfig();
      renderOrg(document.getElementById('content'));
    });
  } else {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Select a team or agent to edit. Drag agents between teams to reassign.</div>';
  }
}

// =========================================================================
// TAURI BRIDGE
// =========================================================================

function registerTauriListeners() {
  if (typeof window !== 'undefined' && window.__TAURI__) {
    window.__TAURI__.event?.listen?.('agent-log', (event) => {
      // Bridge legacy Tauri stream into a synthetic process if needed
      // (the SSE stream is the primary path; Tauri emits a duplicate).
      console.log('[Tauri event]', event.payload);
    });
  }
}
