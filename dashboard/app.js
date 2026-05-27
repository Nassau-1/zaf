/**
 * app.js — ZO WIP Dashboard v2
 * Ports v1 with three upgrades:
 *   1. Multi-repo: repo selector filters all views
 *   2. SSE auto-refresh: EventSource('/api/watch') → re-fetch + re-render on file change
 *   3. Draggable graph: individual node drag + pin; background pans; scroll zooms
 */

/* ═══════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════ */

const DATA_URL  = '/api/data';
const WATCH_URL = '/api/watch';

const STATUS_ORDER = ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'WAITING_INPUT', 'OPEN', 'DONE'];

const STATUS_LABELS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_INPUT: 'Waiting Input',
  BLOCKED: 'Blocked',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
  DONE_WITH_ERRORS: 'Done w/ Errors',
};

const WS_COLORS = {
  'WS-UX':           '#f472b6',
  'WS-SHELL':        '#818cf8',
  'WS-DATA':         '#34d399',
  'WS-SERVICES':     '#60a5fa',
  'WS-CRM':          '#fb923c',
  'WS-INTELLIGENCE': '#a78bfa',
  'WS-REPOS':        '#94a3b8',
  'WS-ASSISTANT':    '#2dd4bf',
  'WS-INFRA':        '#fbbf24',
  'WS-DASHBOARD':    '#38bdf8',
  'WS-DOCS':         '#f0abfc',
  'WS-CLI':          '#86efac',
  'none':            '#64748b',
};

const STATUS_COLORS = {
  OPEN: '#3b82f6',
  IN_PROGRESS: '#6366f1',
  WAITING_INPUT: '#f59e0b',
  BLOCKED: '#ef4444',
  IN_REVIEW: '#a855f7',
  DONE: '#22c55e',
  DONE_WITH_ERRORS: '#f97316',
};

const PRIORITY_COLORS = {
  P0: '#ef4444',
  P1: '#f97316',
  P2: '#eab308',
  P3: '#64748b',
};

/* ═══════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════ */

let STATE = {
  data: null,
  config: null,
  currentView: 'overview',
  selectedRepo: '',          // '' = All; 'zo' | 'zo-agentic-framework' | ...
  filters: { search: '', workstream: '', phase: '', team: '', priority: '', status: '' },
  selectedTicketId: null,
  ticketMap: {},             // id → ticket (active + archived combined)
  graphPan: { x: 0, y: 0, zoom: 1 },
  archiveSort: { col: 'id', dir: 'asc' },
};

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */

async function init() {
  bindNav();
  bindDetailClose();
  bindRefresh();
  await loadData();
  bindRepoSelector();
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
  connectSSE();
  
  // Phase 4 bindings
  bindRunAgentButton();
  bindConsoleControls();
  registerTauriListeners();
}

/* ═══════════════════════════════════════════════════════════════
   DATA LOADING
   ═══════════════════════════════════════════════════════════════ */

async function loadData() {
  try {
    const resp = await fetch(DATA_URL + '?t=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    STATE.data = await resp.json();
 
    try {
      const configResp = await fetch('/api/config?t=' + Date.now());
      if (configResp.ok) {
        STATE.config = await configResp.json();
      }
    } catch (e) {
      console.warn("Failed to load ZAF configs", e);
    }

    // Build ticket map (active + archived)
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

function updateSidebarStats() {
  const tickets = getActiveTickets();
  const s = {};
  for (const t of tickets) s[t.status] = (s[t.status] || 0) + 1;
  document.getElementById('stat-blocked').textContent   = s.BLOCKED || 0;
  document.getElementById('stat-inprogress').textContent = s.IN_PROGRESS || 0;
  document.getElementById('stat-waiting').textContent   = s.WAITING_INPUT || 0;
  document.getElementById('stat-open').textContent      = s.OPEN || 0;
}

function updateBadges() {
  document.getElementById('badge-active').textContent   = getActiveTickets().length;
  document.getElementById('badge-archived').textContent = getArchivedTickets().length;
}

function updateTimestamp() {
  const ts = new Date(STATE.data.generated);
  document.getElementById('sidebar-timestamp').textContent =
    'Parsed: ' + ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hideLoading() {
  document.getElementById('loading-screen')?.remove();
}

function showError(err) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="error-card fade-in">
      <h2>⚠ Could not load data</h2>
      <p>Make sure the server is running and the parser has run:</p>
      <code>cd zo-agentic-framework/dashboard<br>npm install<br>node server.js<br><br>Then open http://localhost:4242</code>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   REPO SELECTOR (new in v2)
   ═══════════════════════════════════════════════════════════════ */

function populateRepoSelector() {
  const sel = document.getElementById('repo-select');
  if (!sel || !STATE.data?.repos) return;
  // Preserve selection if valid
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
    // Reset filters that may not exist in new repo
    STATE.filters = { search: '', workstream: '', phase: '', team: '', priority: '', status: '' };
    updateSidebarStats();
    updateBadges();
    renderView(STATE.currentView);
  });
}

/* Returns active tickets filtered by selected repo */
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

/* ═══════════════════════════════════════════════════════════════
   SSE AUTO-REFRESH (new in v2)
   ═══════════════════════════════════════════════════════════════ */

let sseSource = null;

function connectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }

  setSseStatus('connecting');

  sseSource = new EventSource(WATCH_URL);

  sseSource.onopen = () => {
    setSseStatus('connected');
  };

  sseSource.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event === 'reload') {
        setSseStatus('reloading');
        await loadData();
        renderView(STATE.currentView);
        setSseStatus('connected');
      } else if (msg.event === 'log') {
        openConsoleDrawer();
        appendConsoleLog(msg.log, 'stdout');
      }
    } catch {}
  };

  sseSource.onerror = () => {
    setSseStatus('disconnected');
    sseSource.close();
    sseSource = null;
    // Reconnect after 5 s
    setTimeout(connectSSE, 5000);
  };
}

function setSseStatus(state) {
  const dot   = document.getElementById('sse-dot');
  const label = document.getElementById('sse-label');
  if (!dot || !label) return;

  dot.className = 'sse-dot sse-' + state;
  const labels = {
    connecting:   'Connecting…',
    connected:    'Live',
    reloading:    'Refreshing…',
    disconnected: 'Offline',
  };
  label.textContent = labels[state] || state;
}

/* ═══════════════════════════════════════════════════════════════
   ROUTING
   ═══════════════════════════════════════════════════════════════ */

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
    overview:  'Programme Overview',
    programme: 'Programme Deep-Dive',
    board:     'Ticket Board',
    graph:     'Dependency Graph',
    archive:   'Archive',
    control:   'Control Center',
  };
  document.getElementById('topbar-view-label').textContent = labels[view] || view;

  if (!STATE.data) return;

  closeDetailPanel();
  renderView(view);
}

function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.view);
    });
  });
}

function bindRefresh() {
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await loadData();
    renderView(STATE.currentView);
  });
}

function renderView(view) {
  const content = document.getElementById('content');
  content.scrollTop = 0;
  switch (view) {
    case 'overview':  renderOverview(content);  break;
    case 'programme': renderProgramme(content); break;
    case 'board':     renderBoard(content);     break;
    case 'graph':     renderGraph(content);     break;
    case 'archive':   renderArchive(content);   break;
    case 'control':   renderControl(content);   break;
    default:          renderOverview(content);
  }
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function wsColor(ws)       { return WS_COLORS[ws]       || WS_COLORS['none']; }
function statusColor(s)    { return STATUS_COLORS[s]    || '#64748b'; }
function priorityColor(p)  { return PRIORITY_COLORS[p]  || '#64748b'; }

function statusBadge(status) {
  return `<span class="status-badge status-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function wsBadge(ws) {
  if (!ws || ws === 'none') return '';
  const color = wsColor(ws);
  return `<span class="tag tag-ws bg-ws-${ws}" style="color:${color}">${ws.replace('WS-','')}</span>`;
}

function repoBadge(repoId) {
  if (!repoId || !STATE.selectedRepo === '') return '';
  return `<span class="tag tag-repo">${repoId}</span>`;
}

function priorityBadge(p) {
  if (!p) return '';
  const color = priorityColor(p);
  return `<span class="tag tag-priority" style="background:${color}1a; color:${color}">${p}</span>`;
}

function formatDate(d) {
  if (!d) return '—';
  return String(d).substring(0, 10);
}

function safeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
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
    if (f.phase     && t.phase     !== f.phase)     return false;
    if (f.team      && !(t.team || '').toLowerCase().includes(f.team.toLowerCase())) return false;
    if (f.priority  && t.priority  !== f.priority)  return false;
    if (f.status    && t.status    !== f.status)    return false;
    return true;
  });
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: OVERVIEW
   ═══════════════════════════════════════════════════════════════ */

function renderOverview(container) {
  const active   = getActiveTickets();
  const archived = getArchivedTickets();
  const progs    = getProgrammes();

  const stats = {};
  for (const t of active) stats[t.status] = (stats[t.status] || 0) + 1;

  const wsData = {};
  for (const t of active) {
    const ws = t.workstream || 'none';
    if (!wsData[ws]) wsData[ws] = { total: 0, byStatus: {} };
    wsData[ws].total++;
    wsData[ws].byStatus[t.status] = (wsData[ws].byStatus[t.status] || 0) + 1;
  }

  const programme = progs?.[0];
  const phases    = programme?.phases || [];

  const phaseIcons = { COMPLETE: '✓', ACTIVE: '◉', PENDING: '○' };

  const phasesHtml = phases.map(ph => {
    const gs   = ph.gateStatus.toLowerCase();
    const icon = phaseIcons[ph.gateStatus] || '○';
    return `
      <div class="phase-card">
        <div class="phase-dot ${gs}" title="${ph.gateStatus}">${icon}</div>
        <div class="phase-body">
          <div class="phase-body-top">
            <div class="phase-title">${safeHTML(ph.title)}</div>
            <div class="phase-status-badge ${gs}">${ph.gateStatus}</div>
          </div>
          ${ph.objective ? `<div class="phase-objective">${safeHTML(ph.objective)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const allWs = Object.keys(WS_COLORS).filter(ws => wsData[ws]);
  const wsCardsHtml = allWs.map(ws => {
    const info  = wsData[ws] || { total: 0, byStatus: {} };
    const color = wsColor(ws);
    const statusSegs = STATUS_ORDER.map(s => {
      const count = info.byStatus[s] || 0;
      if (count === 0) return '';
      const pct = ((count / info.total) * 100).toFixed(1);
      return `<div class="ws-status-seg" style="width:${pct}%; background:${statusColor(s)}" title="${s}: ${count}"></div>`;
    }).join('');
    const label = ws === 'none' ? 'Unassigned' : ws;
    return `
      <div class="ws-card" data-ws="${ws}" title="${label}">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${color};border-radius:10px 10px 0 0"></div>
        <div class="ws-card-header">
          <div class="ws-id" style="color:${color}">${label}</div>
        </div>
        <div class="ws-count" style="color:${color}">${info.total}</div>
        <div class="ws-count-label">tickets</div>
        <div class="ws-status-bar">${statusSegs}</div>
      </div>`;
  }).join('');

  const statusSummaryHtml = STATUS_ORDER.map(s => {
    const count = stats[s] || 0;
    if (count === 0) return '';
    return `
      <div class="stat-card" style="cursor:pointer" onclick="applyStatusFilter('${s}')">
        <div class="stat-number" style="color:${statusColor(s)}">${count}</div>
        <div class="stat-label">${STATUS_LABELS[s] || s}</div>
      </div>`;
  }).join('');

  const repoLabel = STATE.selectedRepo
    ? STATE.data.repos.find(r => r.id === STATE.selectedRepo)?.label || STATE.selectedRepo
    : 'All Repos';

  container.innerHTML = `
    <div class="view-programme fade-in">
      <div class="section-header">
        <h1>${programme ? safeHTML(programme.title) : repoLabel}</h1>
        <span class="section-meta">${active.length} active tickets · ${archived.length} archived</span>
      </div>

      <div class="stats-row" style="margin-bottom:24px">
        ${statusSummaryHtml}
      </div>

      ${phases.length > 0 ? `
        <div class="section-header">
          <h2 style="font-size:13px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.07em">Phase Timeline</h2>
        </div>
        <div class="phase-timeline" style="margin-bottom:32px">
          ${phasesHtml}
        </div>
      ` : ''}

      <div class="section-header">
        <h2 style="font-size:13px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.07em">Workstreams</h2>
      </div>
      <div class="workstream-grid">
        ${wsCardsHtml || '<div style="color:var(--text-muted);padding:16px">No workstream data.</div>'}
      </div>
    </div>`;

  container.querySelectorAll('.ws-card[data-ws]').forEach(card => {
    card.addEventListener('click', () => {
      const ws = card.dataset.ws;
      STATE.filters.workstream = ws === 'none' ? '' : ws;
      navigateTo('board');
    });
  });
}

window.applyStatusFilter = function(status) {
  STATE.filters.status = status;
  navigateTo('board');
};

/* ═══════════════════════════════════════════════════════════════
   VIEW: BOARD (KANBAN)
   ═══════════════════════════════════════════════════════════════ */

function renderBoard(container) {
  const tickets = getFilteredTickets();
  const active  = getActiveTickets();

  const workstreams = [...new Set(active.map(t => t.workstream).filter(Boolean))].sort();
  const phases      = [...new Set(active.map(t => t.phase).filter(Boolean))].sort();
  const priorities  = ['P0','P1','P2','P3'];

  const wsOptions = ['<option value="">All Workstreams</option>',
    ...workstreams.map(ws => `<option value="${ws}" ${STATE.filters.workstream === ws ? 'selected' : ''}>${ws}</option>`)
  ].join('');

  const phaseOptions = ['<option value="">All Phases</option>',
    ...phases.map(p => `<option value="${p}" ${STATE.filters.phase === p ? 'selected' : ''}>${p}</option>`)
  ].join('');

  const statusOptions = ['<option value="">All Statuses</option>',
    ...STATUS_ORDER.map(s => `<option value="${s}" ${STATE.filters.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`)
  ].join('');

  const prioOptions = ['<option value="">All Priorities</option>',
    ...priorities.map(p => `<option value="${p}" ${STATE.filters.priority === p ? 'selected' : ''}>${p}</option>`)
  ].join('');

  const groups = {};
  for (const s of STATUS_ORDER) groups[s] = [];
  for (const t of tickets) {
    const key = STATUS_ORDER.includes(t.status) ? t.status : 'OPEN';
    groups[key].push(t);
  }

  const columnsHtml = STATUS_ORDER.map(status => {
    const col  = groups[status] || [];
    const dot  = `<div class="column-dot" style="background:${statusColor(status)}"></div>`;
    const cardsHtml = col.map(t => renderTicketCard(t)).join('');
    return `
      <div class="board-column">
        <div class="column-header">
          ${dot}
          <div class="column-title">${STATUS_LABELS[status] || status}</div>
          <div class="column-count">${col.length}</div>
        </div>
        <div class="column-cards">
          ${cardsHtml || `<div style="padding:12px 8px;font-size:11px;color:var(--text-muted);text-align:center">No tickets</div>`}
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
      <div class="board-columns">
        ${columnsHtml}
      </div>
    </div>`;

  container.querySelector('#board-search')?.addEventListener('input', e => {
    STATE.filters.search = e.target.value;
    renderBoard(container);
  });
  container.querySelector('#filter-ws')?.addEventListener('change', e => {
    STATE.filters.workstream = e.target.value;
    renderBoard(container);
  });
  container.querySelector('#filter-phase')?.addEventListener('change', e => {
    STATE.filters.phase = e.target.value;
    renderBoard(container);
  });
  container.querySelector('#filter-status')?.addEventListener('change', e => {
    STATE.filters.status = e.target.value;
    renderBoard(container);
  });
  container.querySelector('#filter-priority')?.addEventListener('change', e => {
    STATE.filters.priority = e.target.value;
    renderBoard(container);
  });
  container.querySelector('#filter-clear')?.addEventListener('click', () => {
    STATE.filters = { search: '', workstream: '', phase: '', team: '', priority: '', status: '' };
    renderBoard(container);
  });

  container.querySelectorAll('.ticket-card[data-id]').forEach(card => {
    card.addEventListener('click', () => openDetailPanel(card.dataset.id));
  });
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
    blockerCount > 0 ? `<span class="tag tag-blocked">⊗ ${blockerCount} blocker${blockerCount > 1 ? 's':''}</span>` : '',
  ].filter(Boolean).join('');

  const leftBorderColor = t.blocked_by?.length ? '#ef4444' :
    t.status === 'IN_PROGRESS' ? '#6366f1' :
    t.workstream ? wsColor(t.workstream) : '#333';

  return `
    <div class="ticket-card" data-id="${t.id}" style="border-left:3px solid ${leftBorderColor}20">
      <div class="ticket-card-id">${t.id}</div>
      <div class="ticket-card-title">${safeHTML(t.title)}</div>
      <div class="ticket-card-tags">${tags}</div>
      <div class="ticket-card-footer">
        <span class="ticket-card-date">${formatDate(t.updated)}</span>
        ${blocksCount > 0 ? `<span class="ticket-card-blockers" title="Blocks ${blocksCount} ticket(s)">→ ${blocksCount}</span>` : ''}
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   DETAIL PANEL
   ═══════════════════════════════════════════════════════════════ */

function bindDetailClose() {
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
}

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
    if (t.status !== 'DONE' && t.status !== 'ARCHIVED') {
      runBtn.classList.remove('hidden');
    } else {
      runBtn.classList.add('hidden');
    }
  }

  document.getElementById('detail-id').textContent    = t.id;
  document.getElementById('detail-title').textContent = t.title;

  document.getElementById('detail-meta-row').innerHTML = [
    statusBadge(t.status),
    wsBadge(t.workstream),
    priorityBadge(t.priority),
    t.phase    ? `<span class="tag tag-team">${t.phase}</span>` : '',
    t.archetype ? `<span class="tag tag-archetype">${t.archetype}</span>` : '',
    t.repoId   ? `<span class="tag tag-repo">${safeHTML(t.repoId)}</span>` : '',
  ].filter(Boolean).join('');

  const metaFields = [
    ['Programme', t.programme || '—'],
    ['Team',      t.team      || '—'],
    ['Phase',     t.phase     || '—'],
    ['Priority',  t.priority  || '—'],
    ['Archetype', t.archetype || '—'],
    ['Project',   t.project   || '—'],
    ['Repo',      t.repo      || '—'],
    ['Created',   formatDate(t.created)],
    ['Updated',   formatDate(t.updated)],
    ['Usage',     t.usage_checkpoint || '—'],
  ];

  document.getElementById('detail-meta-grid').innerHTML = metaFields.map(([label, value]) =>
    `<div class="meta-field">
      <div class="meta-label">${label}</div>
      <div class="meta-value">${safeHTML(String(value))}</div>
    </div>`
  ).join('');

  const depsEl    = document.getElementById('detail-deps');
  const blockedBy = t.blocked_by || [];
  const blocks    = t.blocks || [];

  if (blockedBy.length > 0 || blocks.length > 0) {
    depsEl.style.display = 'block';
    const blockedByChips = blockedBy.map(b => {
      const linked = STATE.ticketMap[b];
      return `<span class="dep-chip blocked-by" data-id="${b}" title="${linked ? linked.title : b}">⊗ ${b}</span>`;
    }).join('');
    const blocksChips = blocks.map(b => {
      const linked = STATE.ticketMap[b];
      return `<span class="dep-chip blocks" data-id="${b}" title="${linked ? linked.title : b}">→ ${b}</span>`;
    }).join('');
    depsEl.innerHTML = `
      ${blockedBy.length > 0 ? `<div class="deps-title">Blocked by</div><div class="deps-chips">${blockedByChips}</div>` : ''}
      ${blocks.length > 0 ? `<div class="deps-title" style="margin-top:10px">Blocks</div><div class="deps-chips">${blocksChips}</div>` : ''}`;

    depsEl.querySelectorAll('.dep-chip[data-id]').forEach(chip => {
      chip.addEventListener('click', () => openDetailPanel(chip.dataset.id));
    });
  } else {
    depsEl.style.display = 'none';
  }

  const bodyEl = document.getElementById('detail-markdown');
  if (t.body && typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    bodyEl.innerHTML = `<div class="md-content">${marked.parse(t.body)}</div>`;
    bodyEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = true; });
  } else {
    bodyEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px">${safeHTML(t.body || 'No body.')}</div>`;
  }

  panel.classList.add('slide-in');
  setTimeout(() => panel.classList.remove('slide-in'), 300);
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: DEPENDENCY GRAPH (v2 — draggable nodes)
   ═══════════════════════════════════════════════════════════════ */

function renderGraph(container) {
  const graph    = STATE.data.graph;
  const active   = getActiveTickets();
  const activeIds = new Set(active.map(t => t.id));

  const connectedIds = new Set();
  for (const e of graph.edges) {
    if (activeIds.has(e.from) && activeIds.has(e.to)) {
      connectedIds.add(e.from);
      connectedIds.add(e.to);
    }
  }

  const nodes = graph.nodes.filter(n => connectedIds.has(n.id) && activeIds.has(n.id));
  const edges = graph.edges.filter(e => connectedIds.has(e.from) && connectedIds.has(e.to));

  const filterWs = STATE.filters.workstream || '';
  const wsOptions = [...new Set(active.map(t => t.workstream).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="view-graph fade-in">
      <div class="graph-toolbar">
        <span style="font-size:15px;font-weight:700;color:var(--text-primary)">Dependency Graph</span>
        <select class="filter-select" id="graph-ws-filter">
          <option value="">All Workstreams</option>
          ${wsOptions.map(ws => `<option value="${ws}" ${filterWs === ws ? 'selected':''}>${ws}</option>`).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-muted)">${nodes.length} connected nodes · ${edges.length} edges</span>
        <span style="font-size:11px;color:var(--text-muted);font-style:italic">Drag nodes to pin · Double-click to release · Scroll to zoom</span>
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
      <div class="graph-legend">
        ${Object.entries(STATUS_COLORS).map(([s, c]) =>
          `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div>${STATUS_LABELS[s] || s}</div>`
        ).join('')}
      </div>
    </div>`;

  container.querySelector('#graph-ws-filter').addEventListener('change', e => {
    STATE.filters.workstream = e.target.value;
    renderGraph(container);
  });

  drawDraggableGraph(nodes, edges, filterWs);

  container.querySelector('#graph-reset-zoom').addEventListener('click', () => {
    drawDraggableGraph(nodes, edges, filterWs);
  });
}

function drawDraggableGraph(allNodes, allEdges, wsFilter) {
  const svgEl = document.getElementById('graph-svg');
  const root  = document.getElementById('graph-root');
  if (!svgEl || !root) return;

  const nodes = wsFilter ? allNodes.filter(n => n.workstream === wsFilter) : allNodes;
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges   = allEdges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

  if (nodes.length === 0) {
    root.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#525970" font-size="14">No connected tickets in this workstream</text>`;
    return;
  }

  const W = svgEl.clientWidth  || 900;
  const H = svgEl.clientHeight || 500;

  const NODE_W = 120;
  const NODE_H = 38;
  const MARGIN = 60;

  // Initial grid layout
  const pos = {};
  nodes.forEach((n, i) => {
    const cols = Math.ceil(Math.sqrt(nodes.length * 1.5));
    const row  = Math.floor(i / cols);
    const col  = i % cols;
    pos[n.id] = {
      x: MARGIN + col * (NODE_W + 40) + (row % 2 === 0 ? 0 : (NODE_W + 40) / 2),
      y: MARGIN + row * (NODE_H + 50),
    };
  });

  // Spring simulation
  const vel = {};
  nodes.forEach(n => { vel[n.id] = { x: 0, y: 0 }; });
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = pos[b.id].x - pos[a.id].x;
        const dy = pos[b.id].y - pos[a.id].y;
        const dist  = Math.sqrt(dx*dx + dy*dy) || 1;
        const force = 3000 / (dist*dist);
        vel[a.id].x -= (dx/dist)*force; vel[a.id].y -= (dy/dist)*force;
        vel[b.id].x += (dx/dist)*force; vel[b.id].y += (dy/dist)*force;
      }
    }
    for (const e of edges) {
      if (!pos[e.from] || !pos[e.to]) continue;
      const dx = pos[e.to].x - pos[e.from].x;
      const dy = pos[e.to].y - pos[e.from].y;
      const dist  = Math.sqrt(dx*dx + dy*dy) || 1;
      const force = (dist - 180) * 0.05;
      vel[e.from].x += (dx/dist)*force; vel[e.from].y += (dy/dist)*force;
      vel[e.to].x   -= (dx/dist)*force; vel[e.to].y   -= (dy/dist)*force;
    }
    for (const n of nodes) {
      vel[n.id].x *= 0.8; vel[n.id].y *= 0.8;
      pos[n.id].x  += vel[n.id].x;
      pos[n.id].y  += vel[n.id].y;
    }
  }

  // Normalize to viewport
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, pos[n.id].x);
    minY = Math.min(minY, pos[n.id].y);
    maxX = Math.max(maxX, pos[n.id].x + NODE_W);
    maxY = Math.max(maxY, pos[n.id].y + NODE_H);
  }
  const pad    = 40;
  const scaleX = (W - pad*2) / ((maxX - minX) || 1);
  const scaleY = (H - pad*2) / ((maxY - minY) || 1);
  const scale  = Math.min(scaleX, scaleY, 1.2);
  for (const n of nodes) {
    pos[n.id].x = pad + (pos[n.id].x - minX) * scale;
    pos[n.id].y = pad + (pos[n.id].y - minY) * scale;
  }

  // Pinned node state (survives re-renders within session)
  const pinned = {};

  // ── SVG state ─────────────────────────────────────────────────
  let panX = 0, panY = 0, zoom = 1;
  let isPanning = false, panStartX = 0, panStartY = 0;

  function applyTransform() {
    root.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`);
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    const edgesHtml = edges.map(e => {
      const from = pos[e.from], to = pos[e.to];
      if (!from || !to) return '';
      const x1 = from.x + NODE_W/2, y1 = from.y + NODE_H;
      const x2 = to.x   + NODE_W/2, y2 = to.y;
      const my = (y1 + y2) / 2;
      return `<path class="graph-edge" data-from="${e.from}" data-to="${e.to}"
        d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"
        stroke="${statusColor(STATE.ticketMap[e.from]?.status || 'OPEN')}" />`;
    }).join('');

    const nodesHtml = nodes.map(n => {
      const p     = pos[n.id];
      if (!p) return '';
      const color = statusColor(n.status);
      const title = n.title.length > 20 ? n.title.substring(0, 18) + '…' : n.title;
      const pin   = pinned[n.id] ? `<circle cx="${NODE_W - 8}" cy="8" r="3" fill="${color}" opacity="0.8"/>` : '';
      return `
        <g class="graph-node" transform="translate(${p.x},${p.y})" data-id="${n.id}">
          <rect class="graph-node-rect" width="${NODE_W}" height="${NODE_H}"
            fill="${color}22" stroke="${color}" stroke-width="1.5" />
          <text class="graph-node-id" x="6" y="13">${n.id}</text>
          <text class="graph-node-label" x="6" y="28">${safeHTML(title)}</text>
          ${pin}
        </g>`;
    }).join('');

    root.innerHTML = edgesHtml + nodesHtml;
    applyTransform();
    bindNodeInteractions();
  }

  // ── Update edge positions live ────────────────────────────────
  function updateEdges() {
    root.querySelectorAll('.graph-edge').forEach(path => {
      const from = pos[path.dataset.from];
      const to   = pos[path.dataset.to];
      if (!from || !to) return;
      const x1 = from.x + NODE_W/2, y1 = from.y + NODE_H;
      const x2 = to.x   + NODE_W/2, y2 = to.y;
      const my = (y1 + y2) / 2;
      path.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
    });
  }

  // ── Node drag interactions ────────────────────────────────────
  function bindNodeInteractions() {
    root.querySelectorAll('.graph-node').forEach(el => {
      const id = el.dataset.id;
      let isDragging = false, startClientX = 0, startClientY = 0, startPosX = 0, startPosY = 0;

      el.addEventListener('mousedown', e => {
        e.stopPropagation();
        isDragging  = true;
        startClientX = e.clientX;
        startClientY = e.clientY;
        startPosX   = pos[id].x;
        startPosY   = pos[id].y;
        el.style.cursor = 'grabbing';
        e.preventDefault();
      });

      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        delete pinned[id];
        el.querySelector('circle')?.remove();
      });

      el.addEventListener('click', e => {
        if (Math.abs(e.clientX - startClientX) < 5 && Math.abs(e.clientY - startClientY) < 5) {
          openDetailPanel(id);
        }
      });

      // Per-node mousemove / mouseup on window
      function onMouseMove(e) {
        if (!isDragging) return;
        const dx = (e.clientX - startClientX) / zoom;
        const dy = (e.clientY - startClientY) / zoom;
        pos[id].x = startPosX + dx;
        pos[id].y = startPosY + dy;
        el.setAttribute('transform', `translate(${pos[id].x},${pos[id].y})`);
        updateEdges();
      }

      function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;
        el.style.cursor = 'pointer';
        const moved = Math.abs(e.clientX - startClientX) > 5 || Math.abs(e.clientY - startClientY) > 5;
        if (moved) {
          pinned[id] = true;
          // Add pin dot
          const existingPin = el.querySelector('circle');
          if (!existingPin) {
            const color = statusColor(STATE.ticketMap[id]?.status || 'OPEN');
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', NODE_W - 8);
            circle.setAttribute('cy', 8);
            circle.setAttribute('r', 3);
            circle.setAttribute('fill', color);
            circle.setAttribute('opacity', '0.8');
            el.appendChild(circle);
          }
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      el.addEventListener('mousedown', () => {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  // ── Background pan ────────────────────────────────────────────
  svgEl.addEventListener('mousedown', e => {
    if (e.target.closest('.graph-node')) return;
    isPanning  = true;
    panStartX  = e.clientX - panX;
    panStartY  = e.clientY - panY;
    svgEl.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    svgEl.style.cursor = 'grab';
  });

  // ── Scroll zoom (around cursor) ───────────────────────────────
  svgEl.addEventListener('wheel', e => {
    e.preventDefault();
    const oldZoom = zoom;
    zoom = Math.max(0.2, Math.min(4, zoom + e.deltaY * -0.001));
    const rect  = svgEl.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    panX = mx - (mx - panX) * (zoom / oldZoom);
    panY = my - (my - panY) * (zoom / oldZoom);
    applyTransform();
  }, { passive: false });

  render();
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: ARCHIVE
   ═══════════════════════════════════════════════════════════════ */

function renderArchive(container) {
  let tickets = [...getArchivedTickets()];
  const searchVal = STATE.filters.search || '';

  if (searchVal) {
    const q = searchVal.toLowerCase();
    tickets = tickets.filter(t =>
      t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
    );
  }

  const { col, dir } = STATE.archiveSort;
  tickets.sort((a, b) => {
    let va = a[col] || '', vb = b[col] || '';
    if (col === 'id') {
      va = parseInt(va.replace(/[^0-9]/g, '')) || 0;
      vb = parseInt(vb.replace(/[^0-9]/g, '')) || 0;
      return dir === 'asc' ? va - vb : vb - va;
    }
    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  const sortIcon = (c) => {
    if (STATE.archiveSort.col !== c) return `<span class="sort-icon">↕</span>`;
    return `<span class="sort-icon">${STATE.archiveSort.dir === 'asc' ? '↑' : '↓'}</span>`;
  };

  const rows = tickets.map(t => `
    <tr data-id="${t.id}" class="archive-row">
      <td class="td-id">${t.id}</td>
      <td class="td-title">${safeHTML(t.title)}</td>
      <td>${wsBadge(t.workstream)}</td>
      <td>${statusBadge(t.status)}</td>
      ${!STATE.selectedRepo ? `<td class="td-repo">${safeHTML(t.repoId || '—')}</td>` : ''}
      <td class="td-date">${formatDate(t.updated)}</td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="view-archive fade-in">
      <div class="section-header">
        <h1>Archive</h1>
        <span class="section-meta">${tickets.length} of ${getArchivedTickets().length} archived tickets</span>
      </div>

      <div class="board-toolbar" style="background:transparent; padding:0; border:none; margin-bottom:12px">
        <input class="search-input" id="archive-search" type="text" placeholder="Search archived tickets…" value="${safeHTML(searchVal)}" />
      </div>

      <div class="archive-table-wrap">
        <table class="archive-table">
          <thead>
            <tr>
              <th data-col="id">ID${sortIcon('id')}</th>
              <th data-col="title">Title${sortIcon('title')}</th>
              <th data-col="workstream">Workstream${sortIcon('workstream')}</th>
              <th data-col="status">Status${sortIcon('status')}</th>
              ${!STATE.selectedRepo ? `<th data-col="repoId">Repo${sortIcon('repoId')}</th>` : ''}
              <th data-col="updated">Updated${sortIcon('updated')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  container.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const c = th.dataset.col;
      if (STATE.archiveSort.col === c) {
        STATE.archiveSort.dir = STATE.archiveSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        STATE.archiveSort = { col: c, dir: 'asc' };
      }
      renderArchive(container);
    });
  });

  container.querySelector('#archive-search').addEventListener('input', e => {
    STATE.filters.search = e.target.value;
    renderArchive(container);
  });

  container.querySelectorAll('.archive-row[data-id]').forEach(row => {
    row.addEventListener('click', () => openDetailPanel(row.dataset.id));
  });
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: PROGRAMME DEEP DIVE
   ═══════════════════════════════════════════════════════════════ */

function renderProgramme(container) {
  const progs = getProgrammes();
  const programme = progs?.[0];

  if (!programme) {
    container.innerHTML = `<div style="padding:40px; color:var(--text-muted)">No programme data found for selected repo.</div>`;
    return;
  }

  const phaseGateStatus = { COMPLETE: '✓ Complete', ACTIVE: '◉ Active', PENDING: '○ Pending' };

  const phasesHtml = programme.phases.map(ph => {
    const gs = ph.gateStatus.toLowerCase();
    return `
      <div class="phase-card">
        <div class="phase-dot ${gs}">${gs === 'complete' ? '✓' : gs === 'active' ? '◉' : '○'}</div>
        <div class="phase-body">
          <div class="phase-body-top">
            <div class="phase-title">${safeHTML(ph.title)}</div>
            <div class="phase-status-badge ${gs}">${phaseGateStatus[ph.gateStatus] || ph.gateStatus}</div>
          </div>
          ${ph.objective ? `<div class="phase-objective">${safeHTML(ph.objective)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const wsCardsHtml = programme.workstreams.map(ws => {
    const color = wsColor(ws.id);
    return `
      <div class="ws-deep-card">
        <div class="ws-deep-header">
          <div class="ws-deep-id" style="color:${color}; background:${color}18">${ws.id}</div>
        </div>
        <div class="ws-deep-goal">${safeHTML(ws.goal)}</div>
        ${ws.currentState ? `<div class="ws-deep-state">Current: ${safeHTML(ws.currentState)}</div>` : ''}
      </div>`;
  }).join('');

  const oqRows = programme.openQuestions.map(oq => {
    const answered = oq.status === 'ANSWERED';
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap">${oq.id}</td>
        <td>${safeHTML(oq.question)}</td>
        <td><span class="status-badge ${answered ? 'status-DONE' : 'status-OPEN'}">${answered ? 'Answered' : 'Open'}</span></td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="view-deep-dive fade-in">
      <div class="section-header">
        <h1>${safeHTML(programme.title)}</h1>
      </div>

      <div class="deep-dive-section">
        <h2>Phase Gates</h2>
        <div class="phase-timeline">${phasesHtml}</div>
      </div>

      <div class="deep-dive-section">
        <h2>Workstreams</h2>
        ${wsCardsHtml || '<div style="color:var(--text-muted)">No workstreams defined.</div>'}
      </div>

      ${programme.openQuestions.length > 0 ? `
        <div class="deep-dive-section">
          <h2>Open Questions</h2>
          <table class="oq-table">
            <thead><tr><th>ID</th><th>Question</th><th>Status</th></tr></thead>
            <tbody>${oqRows}</tbody>
          </table>
        </div>` : ''}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', init);

/* ═══════════════════════════════════════════════════════════════
   PHASE 4: TELEMETRY CONSOLE DRAWER & TAURI IPC CONTROLLERS
   ═══════════════════════════════════════════════════════════════ */

function bindRunAgentButton() {
  const btn = document.getElementById('detail-run-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const ticketId = STATE.selectedTicketId;
    if (!ticketId) return;
    const t = STATE.ticketMap[ticketId];
    const role = (t.roles && t.roles[0]) || 'engineering';
    const harness = 'mock'; // Defaults to mock harness execution
    
    triggerAgentRun(ticketId, role, harness);
  });
}

function triggerAgentRun(ticketId, role, harness) {
  openConsoleDrawer();
  
  const agentCfg = (STATE.config && STATE.config.agents && STATE.config.agents[role]) || {};
  const model = agentCfg.model || '';
  const reasoning = agentCfg.reasoning || '';
  const heartbeat = agentCfg.heartbeat || '';

  appendConsoleLog(`\n[ZAF Control] Spawning sovereign subshell for ${ticketId} [Role: ${role}, Harness: ${harness}]...`, 'system');
  if (model) appendConsoleLog(`[ZAF Control] Target Model: ${model} | Reasoning: ${reasoning} | Heartbeat: ${heartbeat}s`, 'system');
  
  // Detect Tauri or fallback to HTTP REST path
  if (typeof window !== 'undefined' && window.__TAURI__ !== undefined) {
    appendConsoleLog(`[ZAF Control] Tauri native environment detected. Invoking IPC run-hook...`, 'system');
    window.__TAURI__.core.invoke('spawn_agent_run', { ticketId, role, harness, model, reasoning, heartbeat })
      .then(() => {
        appendConsoleLog(`[ZAF Control] Tauri agent run request sent successfully.`, 'system');
      })
      .catch((err) => {
        appendConsoleLog(`[ZAF Control] Tauri IPC error: ${err}`, 'stderr');
      });
  } else {
    appendConsoleLog(`[ZAF Control] Web browser detected. Dispatching API telemetry trigger...`, 'system');
    fetch(`/api/run?ticket=${ticketId}&role=${role}&harness=${harness}&model=${model}&reasoning=${reasoning}&heartbeat=${heartbeat}`)
      .then(res => res.json())
      .then(data => {
        appendConsoleLog(`[ZAF Control] Telemetry server response: ${JSON.stringify(data)}`, 'system');
      })
      .catch(err => {
        appendConsoleLog(`[ZAF Control] Failed dispatching run request: ${err.message}`, 'stderr');
      });
  }
}

function bindConsoleControls() {
  document.getElementById('console-close-btn')?.addEventListener('click', closeConsoleDrawer);
  document.getElementById('console-clear-btn')?.addEventListener('click', clearConsoleLogs);
}

function openConsoleDrawer() {
  const drawer = document.getElementById('console-drawer');
  const dot = document.getElementById('console-dot');
  if (drawer) drawer.classList.add('active');
  if (dot) dot.classList.add('active');
}

function closeConsoleDrawer() {
  const drawer = document.getElementById('console-drawer');
  const dot = document.getElementById('console-dot');
  if (drawer) drawer.classList.remove('active');
  if (dot) dot.classList.remove('active');
}

function clearConsoleLogs() {
  const content = document.getElementById('console-log-content');
  if (content) content.innerHTML = `> [ZAF Control] Telemetry console cleared.`;
}

function appendConsoleLog(text, type = 'stdout') {
  const content = document.getElementById('console-log-content');
  if (!content) return;
  
  const line = document.createElement('div');
  let traceType = type;
  
  // Detect Paperclip-style traceability headers in logs
  if (text.includes('[TOOL CALL]') || text.includes('🛠️') || text.includes('Executing tool') || text.includes('executing tool') || text.includes('call_tool')) {
    traceType = 'tool-call';
  } else if (text.includes('[API REQUEST]') || text.includes('🌐') || text.includes('fetch') || text.includes('HTTP request')) {
    traceType = 'api-request';
  } else if (text.includes('[DECISION]') || text.includes('🧠') || text.includes('Decision') || text.includes('planning') || text.includes('goal')) {
    traceType = 'decision';
  }
  
  line.className = `console-line ${traceType}`;
  line.textContent = `> ${text}`;
  content.appendChild(line);
  content.scrollTop = content.scrollHeight;
}

function registerTauriListeners() {
  if (typeof window !== 'undefined' && window.__TAURI__ !== undefined) {
    // Listen for live events emitted from Rust backend
    window.__TAURI__.event.listen('agent-log', (event) => {
      openConsoleDrawer();
      appendConsoleLog(event.payload, 'stdout');
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 5: INTERACTIVE CONTROL CENTER (TICKET & ORG BUILDER)
   ═══════════════════════════════════════════════════════════════ */

let activeControlTab = 'ticket';

function renderControl(container) {
  if (!STATE.config) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-secondary)">
        <div class="spinner" style="margin: 0 auto 16px"></div>
        <div>Loading ZAF configurations...</div>
      </div>`;
    fetch('/api/config')
      .then(res => res.json())
      .then(conf => {
        STATE.config = conf;
        renderControl(container);
      })
      .catch(err => {
        container.innerHTML = `<div style="padding:40px;color:#ef4444">Failed to load ZAF configurations: ${err.message}</div>`;
      });
    return;
  }

  const tabs = [
    { id: 'ticket', label: 'Ticket Builder', icon: '🎫' },
    { id: 'agents', label: 'Agent & Org Builder', icon: '👥' },
    { id: 'usage', label: 'Subscription & Usage', icon: '📊' }
  ];

  const tabsHtml = tabs.map(t => `
    <button class="console-btn control-tab-btn ${activeControlTab === t.id ? 'active' : ''}" data-tab="${t.id}" style="padding: 6px 16px; font-size: 12px; font-weight: 600; display:flex; align-items:center; gap:6px;">
      <span>${t.icon}</span> ${t.label}
    </button>
  `).join('');

  let panelHtml = '';

  if (activeControlTab === 'ticket') {
    panelHtml = `
      <div class="fade-in" style="max-width: 650px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-card);">
        <h2 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">🎫 Construct New Ticket Context</h2>
        <form id="zaf-ticket-form" style="display:flex; flex-direction:column; gap:16px;">
          <div class="meta-field">
            <label class="meta-label">Ticket Title</label>
            <input type="text" id="tkt-title" required placeholder="e.g. Implement security headers" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none; transition: border var(--t-fast);" />
          </div>
          
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="meta-field">
              <label class="meta-label">Phase Gate</label>
              <select id="tkt-phase" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none;">
                <option value="P1">Phase 1 — Setup & Parser</option>
                <option value="P2">Phase 2 — UI Core</option>
                <option value="P3">Phase 3 — CLI Integration</option>
                <option value="P4" selected>Phase 4 — Unified Control</option>
              </select>
            </div>
            
            <div class="meta-field">
              <label class="meta-label">Workstream</label>
              <select id="tkt-workstream" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none;">
                <option value="WS-CLI">WS-CLI — CLI harness</option>
                <option value="WS-DASHBOARD">WS-DASHBOARD — Dashboard core</option>
                <option value="WS-UX" selected>WS-UX — Premium styling</option>
                <option value="WS-DOCS">WS-DOCS — Specifications</option>
                <option value="none">none</option>
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="meta-field">
              <label class="meta-label">Priority</label>
              <select id="tkt-priority" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none;">
                <option value="P0">P0 — CRITICAL Block</option>
                <option value="P1">P1 — High Priority</option>
                <option value="P2" selected>P2 — Normal</option>
                <option value="P3">P3 — Low</option>
              </select>
            </div>
            
            <div class="meta-field">
              <label class="meta-label">Assigned Agent Tier</label>
              <select id="tkt-role" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none;">
                <option value="engineering" selected>Engineering Core</option>
                <option value="testing">Quality & Testing</option>
                <option value="coo">Chief Operating Officer</option>
                <option value="data">Data & AI Specialist</option>
                <option value="security">Security Specialist</option>
                <option value="sre">Site Reliability Engineer</option>
              </select>
            </div>
          </div>

          <div class="meta-field">
            <label class="meta-label">Target Repo Context</label>
            <select id="tkt-repo" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none;">
              <option value="zo-agentic-framework" selected>zo-agentic-framework</option>
              <option value="zo">zo</option>
            </select>
          </div>

          <div class="meta-field">
            <label class="meta-label">Task Context & Description</label>
            <textarea id="tkt-description" rows="5" required placeholder="Describe the goal, background context, and requirements for the agent harness to execute..." style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none; resize: vertical; transition: border var(--t-fast);"></textarea>
          </div>

          <button type="submit" class="btn btn-primary" style="margin-top: 8px; font-weight: 600; padding: 10px 16px; border-radius: var(--radius-sm); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
            <span>📁</span> Create Ticket & Auto-Index
          </button>
        </form>
      </div>`;
  } else if (activeControlTab === 'agents') {
    const agentKeys = Object.keys(STATE.config.agents);
    const selectedAgentKey = STATE.selectedAgentKey || agentKeys[0];
    const agent = STATE.config.agents[selectedAgentKey];

    const agentOptions = agentKeys.map(k => `
      <option value="${k}" ${selectedAgentKey === k ? 'selected' : ''}>${STATE.config.agents[k].roleName} (${k})</option>
    `).join('');

    const modelOptions = [
      { id: 'frontier', label: 'Frontier (Claude 3.7 Sonnet / GPT-4.5)' },
      { id: 'normal', label: 'Normal (Claude 3.5 Haiku / GPT-4o-mini)' },
      { id: 'reasoning', label: 'Reasoning (DeepSeek R1 / o3-mini)' }
    ].map(m => `
      <option value="${m.id}" ${agent.model === m.id ? 'selected' : ''}>${m.label}</option>
    `).join('');

    const reasoningLevels = ['high', 'medium', 'low', 'unavailable'].map(l => `
      <option value="${l}" ${agent.reasoning === l ? 'selected' : ''}>${l.toUpperCase()}</option>
    `).join('');

    const toolsList = ['FileSystem', 'ShellSubprocess', 'SecurityAudit', 'DBMigrator'].map(t => {
      const active = agent.tools.includes(t);
      return `
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-secondary); cursor:pointer;">
          <input type="checkbox" class="agent-tool-cb" value="${t}" ${active ? 'checked' : ''} style="accent-color:var(--indigo-400);" />
          <span>${t}</span>
        </label>
      `;
    }).join('');

    const teamCards = STATE.config.org.teams.map(t => {
      const memberChips = t.members.map(m => {
        const name = STATE.config.agents[m]?.roleName || m;
        return `<span class="tag tag-repo" style="font-size:10px; margin:2px;">${name}</span>`;
      }).join('');
      return `
        <div class="ws-deep-card" style="margin-bottom:12px; background: rgba(20,23,32,0.4);">
          <div style="font-weight:600; color:var(--text-primary); font-size:12px; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
            <span style="color:var(--indigo-400);">⊞</span> ${t.name}
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">
            Parent: ${t.parent ? STATE.config.org.teams.find(x => x.id === t.parent)?.name : 'None'}
          </div>
          <div style="display:flex; flex-wrap:wrap;">${memberChips}</div>
        </div>
      `;
    }).join('');

    panelHtml = `
      <div class="fade-in" style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; align-items: start;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;">
          <h2 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">👥 Agent Personality & Limits</h2>
          <div class="meta-field" style="margin-bottom: 16px;">
            <label class="meta-label">Select Agent Profile</label>
            <select id="agent-selector" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none; width:100%;">
              ${agentOptions}
            </select>
          </div>

          <form id="zaf-agent-form" style="display:flex; flex-direction:column; gap:16px;">
            <div class="meta-field">
              <label class="meta-label">Assigned Model Target</label>
              <select id="agent-model" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none; width:100%;">
                ${modelOptions}
              </select>
            </div>

            <div class="meta-field">
              <label class="meta-label">Reasoning Level</label>
              <select id="agent-reasoning" style="background: var(--bg-input); border: 1px solid var(--border-medium); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 12px; outline: none; width:100%;">
                ${reasoningLevels}
              </select>
            </div>

            <div class="meta-field">
              <label class="meta-label" style="display:flex; justify-content:space-between;">
                <span>Heartbeat Interval Speed</span>
                <span id="heartbeat-val" style="color:var(--indigo-400); font-family:monospace;">${agent.heartbeat}s</span>
              </label>
              <div style="display:flex; align-items:center; gap:12px;">
                <input type="range" id="agent-heartbeat" min="10" max="120" value="${agent.heartbeat}" style="flex:1; accent-color:var(--indigo-400);" />
              </div>
            </div>

            <div class="meta-field">
              <label class="meta-label">Authorized Tools Roster</label>
              <div style="display:flex; flex-direction:column; gap:8px; background:var(--bg-input); border:1px solid var(--border-medium); padding:10px 14px; border-radius:var(--radius-sm);">
                ${toolsList}
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="margin-top: 8px; font-weight: 600; padding: 10px 16px; border-radius: var(--radius-sm); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
              <span>💾</span> Save Personality & Limits
            </button>
          </form>
        </div>

        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;">
          <h2 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">🔀 Organization Chart & Teams</h2>
          <div style="display:flex; flex-direction:column;">
            ${teamCards}
          </div>
        </div>
      </div>`;
  } else if (activeControlTab === 'usage') {
    const limit = STATE.config.subscriptions.weeklyLimitHours;
    const used = STATE.config.subscriptions.weeklyUsedHours;
    const pct = ((used / limit) * 100).toFixed(0);

    const projectRows = STATE.config.analytics.projects.map(p => `
      <tr>
        <td style="font-family:monospace; font-size:11px; color:var(--text-secondary); padding:8px 0;">${p.id}</td>
        <td style="font-family:'JetBrains Mono', monospace; font-size:11px; color:var(--amber-400); text-align:right; padding:8px 0;">${p.tokensConsumed.toLocaleString()}</td>
      </tr>
    `).join('');

    panelHtml = `
      <div class="fade-in" style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; text-align:center; display:flex; flex-direction:column; align-items:center;">
          <h2 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 20px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; width:100%; text-align:left;">📊 Weekly Usage Quota</h2>
          
          <div style="position:relative; width:180px; height:180px; display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
            <svg width="180" height="180" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" stroke="var(--border-medium)" stroke-width="6" fill="transparent" />
              <circle cx="50" cy="50" r="40" stroke="var(--indigo-500)" stroke-width="6" fill="transparent" 
                      stroke-dasharray="${2 * Math.PI * 40}" stroke-dashoffset="${2 * Math.PI * 40 * (1 - used / limit)}" stroke-linecap="round"
                      transform="rotate(-90 50 50)" style="filter: drop-shadow(0 0 4px rgba(99,102,241,0.4))" />
            </svg>
            <div style="position:absolute; text-align:center;">
              <div style="font-size:24px; font-weight:700; color:var(--text-primary); font-family:'JetBrains Mono', monospace;">${pct}%</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">Used</div>
            </div>
          </div>

          <div style="font-size:12px; color:var(--text-secondary); line-height:1.6; max-width:280px; text-align:center;">
            Running under Move Capital Developer Suite. You have consumed <strong style="color:var(--text-primary); font-family:monospace;">${used} hours</strong> out of your <strong style="color:var(--text-primary); font-family:monospace;">${limit} hours</strong> weekly budget.
          </div>
        </div>

        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;">
          <h2 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">🪙 Token Consumption per Project</h2>
          <table style="width:100%; border-collapse:collapse; margin-top:8px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <th style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:600; padding:8px 0; text-align:left;">Project / Repo</th>
                <th style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:600; padding:8px 0; text-align:right;">Tokens Consumed</th>
              </tr>
            </thead>
            <tbody>
              ${projectRows}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="view-deep-dive fade-in" style="padding: 24px; max-width: 1100px;">
      <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px;">
        <h1 style="font-size:20px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:8px; margin: 0;">
          <span>⚙️</span> ZAF Sovereign Control Center
        </h1>
        <div style="display:flex; gap:8px; background:var(--bg-panel); border:1px solid var(--border-subtle); padding:4px; border-radius:var(--radius-md);">
          ${tabsHtml}
        </div>
      </div>

      <div id="control-active-panel">
        ${panelHtml}
      </div>
    </div>`;

  container.querySelectorAll('.control-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeControlTab = btn.dataset.tab;
      renderControl(container);
    });
  });

  const ticketForm = container.querySelector('#zaf-ticket-form');
  if (ticketForm) {
    ticketForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('tkt-title').value;
      const description = document.getElementById('tkt-description').value;
      const phase = document.getElementById('tkt-phase').value;
      const workstream = document.getElementById('tkt-workstream').value;
      const priority = document.getElementById('tkt-priority').value;
      const role = document.getElementById('tkt-role').value;
      const repo = document.getElementById('tkt-repo').value;

      try {
        const res = await fetch('/api/ticket/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, phase, workstream, priority, role, repo })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        alert(`🟢 Successfully created ticket: ${data.ticketId}`);
        await loadData();
        navigateTo('board');
      } catch (err) {
        alert(`❌ Failed creating ticket: ${err.message}`);
      }
    });
  }

  const agentSelector = container.querySelector('#agent-selector');
  if (agentSelector) {
    agentSelector.addEventListener('change', () => {
      STATE.selectedAgentKey = agentSelector.value;
      renderControl(container);
    });
  }

  const heartbeatSlider = container.querySelector('#agent-heartbeat');
  if (heartbeatSlider) {
    heartbeatSlider.addEventListener('input', () => {
      const displayVal = container.querySelector('#heartbeat-val');
      if (displayVal) displayVal.textContent = heartbeatSlider.value + 's';
    });
  }

  const agentForm = container.querySelector('#zaf-agent-form');
  if (agentForm) {
    agentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selectKey = agentSelector.value;
      const model = document.getElementById('agent-model').value;
      const reasoning = document.getElementById('agent-reasoning').value;
      const heartbeat = parseInt(heartbeatSlider.value, 10);
      
      const tools = [];
      container.querySelectorAll('.agent-tool-cb:checked').forEach(cb => {
        tools.push(cb.value);
      });

      STATE.config.agents[selectKey].model = model;
      STATE.config.agents[selectKey].reasoning = reasoning;
      STATE.config.agents[selectKey].heartbeat = heartbeat;
      STATE.config.agents[selectKey].tools = tools;

      try {
        const res = await fetch('/api/config/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(STATE.config)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        alert(`🟢 Custom agent configurations successfully persisted!`);
        renderControl(container);
      } catch (err) {
        alert(`❌ Failed persisting configs: ${err.message}`);
      }
    });
  }
}
