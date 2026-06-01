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
  activeProcessTab: null,
  consoleOpen: false,
  audit: [],
  cliDiscoveryCache: {},
  selectedAgentKey: null,
  selectedOrgTeamId: null,
  selectedOrgAgentKey: null,
  controlTab: 'ticket',
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
          break;
        case 'process.log':
          onProcessLog(msg);
          break;
        case 'process.end':
          onProcessEnd(msg.meta);
          break;
        case 'process.cleared':
          for (const [id, p] of STATE.processes) {
            if (p.meta.status !== 'running') STATE.processes.delete(id);
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
    board:'Ticket Board', graph:'Dependency Graph', archive:'Archive',
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
    case 'graph':     renderGraph(c);     break;
    case 'archive':   renderArchive(c);   break;
    case 'control':   renderControl(c);   break;
    case 'org':       renderOrg(c);       break;
    case 'audit':     renderAudit(c);     break;
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
  document.getElementById('detail-meta-row').innerHTML = [
    statusBadge(t.status),
    wsBadge(t.workstream),
    priorityBadge(t.priority),
    t.phase ? `<span class="tag tag-team">${t.phase}</span>` : '',
    t.archetype ? `<span class="tag tag-archetype">${t.archetype}</span>` : '',
    t.repoId ? `<span class="tag tag-repo">${safeHTML(t.repoId)}</span>` : '',
  ].filter(Boolean).join('');

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

// Available harness ids (kept in sync with cli/zaf.js HARNESS_MAP and server CLI_HARNESS_COMMANDS)
const HARNESS_OPTIONS = [
  { id: 'mock',        label: 'Mock (simulated telemetry in dashboard)' },
  { id: 'claude-code', label: 'Claude Code CLI (interactive — requires terminal)' },
  { id: 'codex',       label: 'OpenAI Codex CLI (interactive — requires terminal)' },
  { id: 'gemini-cli',  label: 'Gemini CLI (interactive — requires terminal)' },
];

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
          <div class="zaf-heartbeat-hint" id="zaf-harness-note">${a.harness === 'mock' ? 'Mock streams simulated telemetry into the multi-console.' : 'Interactive CLIs need a real terminal — the dashboard will tell you the exact command to paste.'}</div>
        </div>

        <div class="zaf-field">
          <label>Model</label>
          <input id="zaf-launch-model" placeholder="e.g. claude-3-7-sonnet, gpt-4.5, gemini-2.5-pro" value="${safeHTML(a.customModel || a.model || '')}" />
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="zaf-field">
            <label>Reasoning</label>
            <select id="zaf-launch-reasoning">
              ${['high','medium','low','unavailable'].map(r => `<option value="${r}" ${(a.reasoning||'medium')===r?'selected':''}>${r}</option>`).join('')}
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

  const roleSel  = modal.querySelector('#zaf-launch-role');
  const harnessSel = modal.querySelector('#zaf-launch-harness');
  const hbSlider = modal.querySelector('#zaf-launch-hb');
  const hbVal    = modal.querySelector('#zaf-launch-hbval');
  const harnessNote = modal.querySelector('#zaf-harness-note');
  const modelInput = modal.querySelector('#zaf-launch-model');
  const reasoningSel = modal.querySelector('#zaf-launch-reasoning');

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
    modelInput.value = cfg.customModel || cfg.model || '';
    reasoningSel.value = cfg.reasoning || 'medium';
    hbSlider.value = cfg.heartbeat || 40;
    hbVal.textContent = `${hbSlider.value} seconds`;
    updateNote();
  };
  const updateNote = () => {
    if (harnessSel.value === 'mock') harnessNote.textContent = 'Mock streams simulated telemetry into the multi-console — you will see TOOL CALL / API REQUEST / DECISION lines appear live.';
    else harnessNote.textContent = 'Interactive CLIs need a real terminal. Dashboard launches will print the exact paste-able command instead of streaming the live CLI.';
  };

  roleSel.addEventListener('change', refreshFromRole);
  harnessSel.addEventListener('change', updateNote);
  hbSlider.addEventListener('input', () => { hbVal.textContent = `${hbSlider.value} seconds`; });

  const close = () => modal.remove();
  modal.querySelector('#zaf-launch-close').addEventListener('click', close);
  modal.querySelector('.zaf-launch-backdrop').addEventListener('click', close);
  modal.querySelector('#zaf-launch-cancel').addEventListener('click', close);

  modal.querySelector('#zaf-launch-fire').addEventListener('click', () => {
    const role      = roleSel.value;
    const harness   = harnessSel.value;
    const model     = modelInput.value.trim();
    const reasoning = reasoningSel.value;
    const heartbeat = hbSlider.value;
    const prompt    = modal.querySelector('#zaf-launch-prompt').value.trim();
    close();
    triggerAgentRun({
      ticketId: ticket.id,
      role, harness, model, reasoning, heartbeat,
      repo: ticket.repoId || '',
      promptAddendum: prompt,
    });
  });

  setTimeout(() => modelInput.focus(), 50);
}

function triggerAgentRun(opts) {
  const params = new URLSearchParams({
    ticket: opts.ticketId,
    role: opts.role,
    harness: opts.harness,
    model: opts.model || '',
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
      model: opts.model || '',
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
  const rows = tickets.map(t => `
    <tr data-id="${t.id}" class="archive-row">
      <td class="td-id">${t.id}</td>
      <td class="td-title">${safeHTML(t.title)}</td>
      <td>${wsBadge(t.workstream)}</td>
      <td>${statusBadge(t.status)}</td>
      ${!STATE.selectedRepo ? `<td class="td-repo">${safeHTML(t.repoId||'—')}</td>` : ''}
      <td class="td-date">${formatDate(t.updated)}</td>
    </tr>`).join('');
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
  const progs = getProgrammes();
  const programme = progs?.[0];
  if (!programme) { container.innerHTML = `<div style="padding:40px;color:var(--text-muted)">No programme data found for selected repo.</div>`; return; }
  const phasesHtml = programme.phases.map(ph => {
    const gs = ph.gateStatus.toLowerCase();
    return `<div class="phase-card">
      <div class="phase-dot ${gs}">${gs==='complete'?'✓':gs==='active'?'◉':'○'}</div>
      <div class="phase-body">
        <div class="phase-body-top">
          <div class="phase-title">${safeHTML(ph.title)}</div>
          <div class="phase-status-badge ${gs}">${ph.gateStatus}</div>
        </div>
        ${ph.objective ? `<div class="phase-objective">${safeHTML(ph.objective)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  const wsCardsHtml = programme.workstreams.map(ws => {
    const c = wsColor(ws.id);
    return `<div class="ws-deep-card">
      <div class="ws-deep-header"><div class="ws-deep-id" style="color:${c};background:${c}18">${ws.id}</div></div>
      <div class="ws-deep-goal">${safeHTML(ws.goal)}</div>
      ${ws.currentState ? `<div class="ws-deep-state">Current: ${safeHTML(ws.currentState)}</div>` : ''}
    </div>`;
  }).join('');
  const oqRows = programme.openQuestions.map(oq => {
    const answered = oq.status === 'ANSWERED';
    return `<tr><td style="font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap">${oq.id}</td><td>${safeHTML(oq.question)}</td><td><span class="status-badge ${answered?'status-DONE':'status-OPEN'}">${answered?'Answered':'Open'}</span></td></tr>`;
  }).join('');
  container.innerHTML = `
    <div class="view-deep-dive fade-in">
      <div class="section-header"><h1>${safeHTML(programme.title)}</h1></div>
      <div class="deep-dive-section"><h2>Phase Gates</h2><div class="phase-timeline">${phasesHtml}</div></div>
      <div class="deep-dive-section"><h2>Workstreams</h2>${wsCardsHtml || '<div style="color:var(--text-muted)">No workstreams defined.</div>'}</div>
      ${programme.openQuestions.length ? `<div class="deep-dive-section"><h2>Open Questions</h2><table class="oq-table"><thead><tr><th>ID</th><th>Question</th><th>Status</th></tr></thead><tbody>${oqRows}</tbody></table></div>` : ''}
    </div>`;
}

// =========================================================================
// MULTI-CONSOLE TERMINAL PANEL
// =========================================================================

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
}
function closeConsolePanel() {
  STATE.consoleOpen = false;
  document.getElementById('console-panel').classList.remove('active');
  document.getElementById('console-panel-dot').classList.remove('active');
  document.getElementById('console-pulse').classList.remove('active');
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
  renderConsoleTabs();
  updateShellCounter();
}

function renderConsoleTabs() {
  const tabsEl = document.getElementById('console-tabs');
  const bodiesEl = document.getElementById('console-bodies');
  const emptyEl = document.getElementById('console-empty');
  if (!tabsEl) return;

  const procs = Array.from(STATE.processes.values()).sort((a,b) => a.meta.processId.localeCompare(b.meta.processId));
  if (!procs.length) {
    tabsEl.innerHTML = '';
    bodiesEl.querySelectorAll('.console-body').forEach(b => b.remove());
    if (emptyEl) emptyEl.style.display = 'flex';
    STATE.activeProcessTab = null;
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  if (!procs.find(p => p.meta.processId === STATE.activeProcessTab)) {
    STATE.activeProcessTab = procs[procs.length - 1].meta.processId;
  }

  tabsEl.innerHTML = procs.map(({ meta }) => {
    const statusClass = meta.status === 'running' ? 'running' :
                       meta.status === 'completed' ? 'completed' :
                       meta.status === 'killed' ? 'killed' :
                       meta.status === 'external' ? 'external' : 'failed';
    const dur = meta.durationSec != null ? `${meta.durationSec.toFixed(1)}s`
              : `${((Date.now() - meta.startTime)/1000).toFixed(0)}s+`;
    const isActive = STATE.activeProcessTab === meta.processId;
    return `
      <div class="console-tab ${isActive?'active':''}" data-process-id="${meta.processId}">
        <span class="tab-status-dot ${statusClass}"></span>
        <span class="tab-id">${meta.processId}</span>
        <span class="tab-meta">${meta.role} · ${meta.ticketId}</span>
        <span class="tab-meta">${dur}</span>
        <span class="tab-close" data-close="${meta.processId}" title="Remove from tabs">✕</span>
      </div>`;
  }).join('');

  // Body containers
  const existingBodies = new Set(Array.from(bodiesEl.querySelectorAll('.console-body')).map(b => b.dataset.processId));
  for (const { meta, lines } of procs) {
    let body = bodiesEl.querySelector(`.console-body[data-process-id="${meta.processId}"]`);
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
          <span>Harness<strong> ${meta.harness}</strong></span>
          <span>Model<strong> ${meta.model || 'default'}</strong></span>
          <span>Heartbeat<strong> ${meta.heartbeat || '—'}s</strong></span>
          <span class="console-body-status">Status<strong> ${meta.status}</strong></span>
        </div>
        <div class="console-body-logs" data-logs-for="${meta.processId}"></div>`;
      bodiesEl.appendChild(body);
      const logsEl = body.querySelector('.console-body-logs');
      for (const entry of lines) {
        appendLineToLogs(logsEl, entry);
      }
    } else {
      // Update status in meta strip
      body.querySelector('.console-body-status')?.replaceChildren(...statusFragment(meta));
    }
    existingBodies.delete(meta.processId);
    body.classList.toggle('active', STATE.activeProcessTab === meta.processId);
  }
  for (const stale of existingBodies) {
    bodiesEl.querySelector(`.console-body[data-process-id="${stale}"]`)?.remove();
  }

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
}

function statusFragment(meta) {
  const span = document.createElement('span');
  span.textContent = 'Status';
  const strong = document.createElement('strong');
  strong.textContent = ' ' + meta.status;
  return [span, strong];
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

  const kinds = ['', 'process', 'agent', 'config', 'ticket', 'server'];
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
    { id:'ticket', label:'Ticket Builder', icon:'TKT' },
    { id:'agents', label:'Agent Editor',   icon:'AGT' },
    { id:'usage',  label:'Telemetry & Usage', icon:'USE' },
  ];
  const tabsHtml = tabs.map(t => `<button class="zaf-control-tab ${tab===t.id?'active':''}" data-tab="${t.id}"><span>${t.icon}</span> ${t.label}</button>`).join('');

  let body = '';
  if (tab === 'ticket')      body = renderControlTicketBuilder();
  else if (tab === 'agents') body = renderControlAgentEditor();
  else if (tab === 'usage')  body = renderControlUsage();

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

  if (tab === 'ticket') wireTicketBuilder(container);
  if (tab === 'agents') wireAgentEditor(container);
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

// ---- Agent editor ----
function renderControlAgentEditor() {
  const agents = STATE.config.agents;
  const keys = Object.keys(agents);
  const key = STATE.selectedAgentKey || keys[0];
  const a = agents[key] || { roleName:'', model:'frontier', customModel:'', reasoning:'medium', heartbeat:40, harness:'mock', structuralRole:'worker', manager:null, tools:[] };
  const tools = STATE.config.toolsRegistry || [];

  const opt = (val, sel, label) => `<option value="${val}" ${sel===val?'selected':''}>${label}</option>`;

  return `
    <div class="zaf-control-grid">
      <div class="zaf-control-card">
        <h2>Agent Personality & Limits</h2>
        <div class="zaf-field"><label>Select Agent Profile</label>
          <select id="agent-selector">${keys.map(k => `<option value="${k}" ${k===key?'selected':''}>${agents[k].roleName} (${k})</option>`).join('')}</select>
        </div>
        <form id="zaf-agent-form" style="display:flex;flex-direction:column;gap:12px;">
          <div class="zaf-field"><label>Role Name</label><input id="agent-name" value="${safeHTML(a.roleName)}" /></div>
          <div class="zaf-field"><label>Authorized CLIs (multi-select — agents can run on any of these harnesses)</label>
            <div id="agent-harness-multi" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--bg-input);border:1px solid var(--border-medium);padding:10px 12px;border-radius:var(--radius-sm);">
              ${HARNESS_OPTIONS.map(h => {
                const isActive = (Array.isArray(a.harnesses) && a.harnesses.length)
                  ? a.harnesses.includes(h.id)
                  : (a.harness === h.id);
                return `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                  <input type="checkbox" class="agent-harness-cb" value="${h.id}" ${isActive?'checked':''} style="accent-color:var(--indigo-400);" />
                  <span>${h.label}</span>
                </label>`;
              }).join('')}
            </div>
            <div class="zaf-heartbeat-hint">First checked harness is the default. Use <strong>Probe capabilities</strong> below to inspect each CLI live.</div>
          </div>
          <div class="zaf-field"><label>Default harness (used when launching without override)</label>
            <select id="agent-harness">
              ${HARNESS_OPTIONS.map(h => opt(h.id, a.harness || 'mock', h.label)).join('')}
            </select>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button type="button" class="zaf-btn secondary" id="cli-probe-btn">⚙ Probe capabilities</button>
            <span id="cli-probe-status" style="font-size:11px;color:var(--text-muted)"></span>
          </div>
          <div class="zaf-discovery-result" id="cli-probe-result" style="display:none"></div>

          <div class="zaf-field"><label>Model Preset</label>
            <select id="agent-model">
              ${['frontier','normal','reasoning','custom'].map(m => opt(m, a.model, m)).join('')}
            </select>
          </div>
          <div class="zaf-field" id="agent-custom-wrap" style="${a.model==='custom'?'':'display:none'}">
            <label>Custom Model String</label>
            <input id="agent-custom-model" placeholder="claude-3-7-sonnet@latest" value="${safeHTML(a.customModel||'')}" />
          </div>
          <div class="zaf-field"><label>Reasoning Level</label>
            <select id="agent-reasoning">
              ${['high','medium','low','unavailable'].map(r => opt(r, a.reasoning, r)).join('')}
            </select>
          </div>
          <div class="zaf-field"><label>Structural Role (alters generated persona & bounds)</label>
            <select id="agent-struct-role">
              ${Object.entries(STRUCTURAL_PERSONAS).map(([id,p]) => `<option value="${id}" ${a.structuralRole===id?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="zaf-persona-preview" id="persona-preview"></div>

          <div class="zaf-field"><label>Supervisor (N+1)</label>
            <select id="agent-manager">
              <option value="">None (reports to operator)</option>
              ${keys.filter(k => k !== key).map(k => `<option value="${k}" ${a.manager===k?'selected':''}>${agents[k].roleName} (${k})</option>`).join('')}
            </select>
          </div>

          <div class="zaf-field"><label><span>Heartbeat Interval</span><span class="zaf-heartbeat-val" id="heartbeat-val">${a.heartbeat} seconds (telemetry check)</span></label>
            <div class="zaf-heartbeat-row"><input type="range" id="agent-heartbeat" min="5" max="300" step="5" value="${a.heartbeat}" /></div>
            <div class="zaf-heartbeat-hint">Every interval, the subshell emits a heartbeat. Lower = more frequent telemetry, higher token usage.</div>
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

          <button type="submit" class="zaf-btn">Save Personality & Limits</button>
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

  const modelSel = container.querySelector('#agent-model');
  modelSel?.addEventListener('change', () => {
    container.querySelector('#agent-custom-wrap').style.display = modelSel.value === 'custom' ? '' : 'none';
  });

  const slider = container.querySelector('#agent-heartbeat');
  const sliderVal = container.querySelector('#heartbeat-val');
  slider?.addEventListener('input', () => { sliderVal.textContent = `${slider.value} seconds (telemetry check)`; });

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

  // CLI probe
  container.querySelector('#cli-probe-btn')?.addEventListener('click', async () => {
    const harness = container.querySelector('#agent-harness').value;
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

      // Update reasoning dropdown with values from --help if present
      const reasonHints = (r.flags || []).filter(f => /reason|effort/i.test(f));
      if (reasonHints.length) {
        const note = document.createElement('div');
        note.style.fontSize = '10px';
        note.style.color = 'var(--text-muted)';
        note.textContent = 'Detected reasoning-related flags: ' + reasonHints.join(', ');
        resultEl.appendChild(note);
      }
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
    c.model          = container.querySelector('#agent-model').value;
    c.customModel    = container.querySelector('#agent-custom-model')?.value || '';
    c.reasoning      = container.querySelector('#agent-reasoning').value;
    c.harness        = container.querySelector('#agent-harness').value;
    c.harnesses      = Array.from(container.querySelectorAll('.agent-harness-cb:checked')).map(cb => cb.value);
    if (!c.harnesses.length) c.harnesses = [c.harness];
    if (!c.harnesses.includes(c.harness)) c.harness = c.harnesses[0];
    c.structuralRole = container.querySelector('#agent-struct-role').value;
    c.manager        = container.querySelector('#agent-manager').value || null;
    c.heartbeat      = parseInt(slider.value, 10);
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

// ---- Usage ----
function renderControlUsage() {
  const sub = STATE.config.subscriptions || { weeklyLimitHours: 20, weeklyUsedHours: 0 };
  const limit = sub.weeklyLimitHours || 20;
  const used = sub.weeklyUsedHours || 0;
  const pct  = Math.min(100, (used/limit*100));
  const R = 40, C = 2*Math.PI*R;
  const projects = STATE.config.analytics?.projects || [];
  const maxTokens = Math.max(1, ...projects.map(p => p.tokensConsumed || 0));

  const projectRows = projects.map(p => `
    <div class="zaf-token-row">
      <span style="color:var(--text-primary)">${p.id}</span>
      <div class="zaf-token-bar"><div style="width:${(p.tokensConsumed/maxTokens*100).toFixed(1)}%"></div></div>
      <span class="zaf-token-count">${p.tokensConsumed.toLocaleString()}</span>
    </div>`).join('');

  const agentUsage = STATE.config.agentUsage || {};
  const agentRows = Object.entries(agentUsage).map(([k, u]) => `
    <div class="zaf-token-row">
      <span style="color:var(--text-primary)">${k} <span style="color:var(--text-muted)">(${u.runs} runs)</span></span>
      <span style="color:var(--text-secondary)">${u.secondsTotal.toFixed(1)}s</span>
      <span class="zaf-token-count">${u.tokensConsumed.toLocaleString()}</span>
    </div>`).join('');

  return `
    <div class="zaf-control-grid">
      <div class="zaf-control-card">
        <h2>Weekly Telemetry Quota (Real-Time)</h2>
        <div class="zaf-usage-donut">
          <svg width="180" height="180" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${R}" stroke="var(--border-medium)" stroke-width="6" fill="none"/>
            <circle cx="50" cy="50" r="${R}" stroke="var(--indigo-500)" stroke-width="6" fill="none"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(used,limit)/limit)}"
              stroke-linecap="round" transform="rotate(-90 50 50)"
              style="filter: drop-shadow(0 0 4px rgba(99,102,241,0.4))" />
          </svg>
          <div class="zaf-usage-center">
            <div class="zaf-usage-pct">${pct.toFixed(2)}%</div>
            <div class="zaf-usage-sub">Consumed</div>
          </div>
        </div>
        <div class="zaf-usage-detail">
          Telemetry accumulates from real CLI subprocess execution time. Used <strong>${used.toFixed(5)}h</strong> of <strong>${limit}h</strong> weekly developer subscription quota.
        </div>
      </div>

      <div class="zaf-control-card">
        <h2>Token Consumption — per Project</h2>
        ${projectRows || '<div style="color:var(--text-muted);font-size:11px">No project telemetry yet.</div>'}
        <h2 style="margin-top:18px">Token Consumption — per Agent Role</h2>
        ${agentRows || '<div style="color:var(--text-muted);font-size:11px">No agent runs recorded.</div>'}
      </div>
    </div>`;
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
  document.getElementById('org-add-agent').addEventListener('click', async () => {
    const key = prompt('Unique agent key (lowercase, no spaces)?'); if (!key) return;
    if (STATE.config.agents[key]) return alert('Agent key exists');
    const roleName = prompt('Role name?'); if (!roleName) return;
    STATE.config.agents[key] = {
      roleName, model: 'normal', customModel: '', reasoning: 'medium',
      heartbeat: 40, harness: 'claude-code', structuralRole: 'worker',
      manager: null, tools: ['FileSystem'],
    };
    // Add to first team or create one
    if (!STATE.config.org.teams.length) STATE.config.org.teams.push({ id:'default', name:'Default Team', parent:null, members:[] });
    STATE.config.org.teams[0].members.push(key);
    await persistConfig();
    renderOrg(document.getElementById('content'));
  });
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
