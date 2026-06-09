const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Config helpers ───────────────────────────────────────────────────────────

function getSidecarUrl() {
  return (vscode.workspace.getConfiguration('zaf').get('sidecarUrl') || 'http://localhost:4242').replace(/\/$/, '');
}

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const base = getSidecarUrl();
    const url = new URL(urlPath, base);
    const mod = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = mod.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function apiGet(urlPath) { return apiRequest('GET', urlPath, null); }
function apiPost(urlPath, body) { return apiRequest('POST', urlPath, body); }

// ─── SSE connection at extension-host level (for PTY mirror) ─────────────────

let sseReq = null;
let sseReconnectTimer = null;
const ptyTerminals = new Map(); // processId -> ZafPseudoTerminal

function connectSSE(context, views) {
  if (sseReq) { try { sseReq.destroy(); } catch {} }
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }

  const base = getSidecarUrl();
  const url = new URL('/api/watch', base);
  const mod = url.protocol === 'https:' ? https : http;

  let buf = '';

  try {
    sseReq = mod.get(url.toString(), res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              handleSseEvent(ev, views);
            } catch {}
          }
        }
      });
      res.on('end', () => {
        sseReconnectTimer = setTimeout(() => connectSSE(context, views), 5000);
      });
    });
    sseReq.on('error', () => {
      sseReconnectTimer = setTimeout(() => connectSSE(context, views), 5000);
    });
    context.subscriptions.push({ dispose: () => { try { sseReq.destroy(); } catch {} } });
  } catch {
    sseReconnectTimer = setTimeout(() => connectSSE(context, views), 5000);
  }
}

function handleSseEvent(ev, views) {
  if (!ev || !ev.event) return;

  if (ev.event === 'process.pty') {
    const { processId, data } = ev;
    const pty = ptyTerminals.get(processId);
    if (pty) {
      const bytes = Buffer.from(data, 'base64').toString('binary');
      pty.write(bytes);
    }
  }

  if (ev.event === 'process.start' || ev.event === 'process.end' || ev.event === 'process.cleared') {
    views.shells?.refresh();
  }

  if (ev.event === 'reload') {
    views.board?.refresh();
    views.shells?.refresh();
    views.audit?.refresh();
  }

  if (ev.event === 'audit') {
    views.audit?.push(ev.entry);
  }
}

// ─── PTY mirror ───────────────────────────────────────────────────────────────

class ZafPseudoTerminal {
  constructor(processId, meta) {
    this.processId = processId;
    this.meta = meta;
    this._writeEmitter = new vscode.EventEmitter();
    this._closeEmitter = new vscode.EventEmitter();
    this.onDidWrite = this._writeEmitter.event;
    this.onDidClose = this._closeEmitter.event;
  }

  open(_dimensions) {
    // Replay buffered PTY output
    apiGet(`/api/process/buffer?id=${this.processId}`).then(data => {
      if (!data || !data.buffer) return;
      for (const chunk of data.buffer) {
        const bytes = Buffer.from(chunk.data, 'base64').toString('binary');
        this._writeEmitter.fire(bytes);
      }
    }).catch(() => {});
  }

  handleInput(data) {
    apiPost(`/api/process/${this.processId}/steer`, { text: data }).catch(() => {});
  }

  setDimensions(dimensions) {
    apiPost(`/api/process/${this.processId}/resize`, { cols: dimensions.columns, rows: dimensions.rows }).catch(() => {});
  }

  write(bytes) {
    this._writeEmitter.fire(bytes);
  }

  terminate() {
    this._closeEmitter.fire(0);
    ptyTerminals.delete(this.processId);
  }
}

function openPtyMirror(processId, meta) {
  // If terminal already open, just show it
  if (ptyTerminals.has(processId)) {
    const existing = ptyTerminals.get(processId);
    existing._terminal?.show();
    return;
  }

  const pty = new ZafPseudoTerminal(processId, meta);
  const terminal = vscode.window.createTerminal({
    name: `ZAF — ${meta.ticketId || processId} [${meta.harness || ''}]`,
    pty,
  });
  pty._terminal = terminal;
  ptyTerminals.set(processId, pty);
  terminal.show(true);

  // Clean up when terminal is closed
  const disposable = vscode.window.onDidCloseTerminal(t => {
    if (t === terminal) {
      ptyTerminals.delete(processId);
      disposable.dispose();
    }
  });
}

// ─── Webview HTML builders ────────────────────────────────────────────────────

function csp(sidecarUrl) {
  const origin = new URL(sidecarUrl).origin;
  return `default-src 'none'; connect-src ${origin}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;`;
}

function getBoardHtml(sidecarUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(sidecarUrl)}">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:8px; background:#0f0f11; color:#c0c0c0;
  font:12px/1.4 'Segoe UI',system-ui,sans-serif; overflow-x:hidden; }
.status-bar { font-size:10px; color:#444; margin-bottom:6px;
  display:flex; justify-content:space-between; align-items:center; }
.dot { display:inline-block; width:6px; height:6px; border-radius:50%;
  margin-right:4px; vertical-align:middle; }
.filters { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
.fb { padding:2px 7px; border-radius:3px; border:1px solid #2a2a30;
  background:#111115; color:#777; cursor:pointer; font-size:10px; }
.fb.active { border-color:#10b981; color:#10b981; }
.card { padding:8px; border-radius:5px; border:1px solid #1e1e26;
  background:#111115; margin-bottom:5px; cursor:pointer; transition:border-color .15s; }
.card:hover { border-color:#2a2a38; }
.ct { display:flex; align-items:center; gap:5px; margin-bottom:3px; }
.cid { font-size:10px; color:#444; font-family:monospace; }
.badge { padding:1px 5px; border-radius:2px; font-size:9px; font-weight:700; text-transform:uppercase; }
.OPEN { background:#0d1f0d; color:#4ade80; }
.IN_PROGRESS { background:#0d0d1f; color:#818cf8; }
.BLOCKED { background:#1f0d0d; color:#f87171; }
.WAITING_INPUT { background:#1f1a0d; color:#fbbf24; }
.IN_REVIEW { background:#0d1a1f; color:#38bdf8; }
.DONE { background:#111; color:#444; }
.DONE_WITH_ERRORS { background:#1a1010; color:#f87171; }
.ctitle { font-size:11px; color:#dfdfdf; line-height:1.3; }
.cmeta { display:flex; gap:8px; margin-top:3px; font-size:10px; color:#444; }
.launch { margin-top:5px; padding:2px 9px; background:#10b98118; border:1px solid #10b981;
  color:#10b981; border-radius:3px; font-size:10px; cursor:pointer; }
.launch:hover { background:#10b98130; }
.empty { color:#333; text-align:center; padding:24px 0; font-size:11px; }
</style>
</head>
<body>
<div class="status-bar">
  <span><span class="dot" id="dot" style="background:#f87171"></span><span id="conn">Connecting…</span></span>
  <span id="cnt">—</span>
</div>
<div class="filters" id="filters">
  <button class="fb active" data-s="">All</button>
  <button class="fb" data-s="OPEN">Open</button>
  <button class="fb" data-s="IN_PROGRESS">In Progress</button>
  <button class="fb" data-s="BLOCKED">Blocked</button>
  <button class="fb" data-s="WAITING_INPUT">Waiting</button>
  <button class="fb" data-s="IN_REVIEW">Review</button>
</div>
<div id="board"></div>
<script>
const vsc = acquireVsCodeApi();
const SIDECAR = '${sidecarUrl}';
let tickets = [], filter = '';

document.querySelectorAll('.fb').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fb').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); filter = b.dataset.s; render();
}));

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function statusClass(s) {
  return s.replace(/ /g,'_');
}

function render() {
  const list = tickets.filter(t => !filter || t.status === filter);
  document.getElementById('cnt').textContent = list.length + ' tickets';
  const el = document.getElementById('board');
  if (!list.length) { el.innerHTML = '<div class="empty">No tickets</div>'; return; }
  el.innerHTML = list.map(t => \`
    <div class="card" data-id="\${t.id}">
      <div class="ct">
        <span class="cid">\${esc(t.id)}</span>
        <span class="badge \${statusClass(t.status)}">\${esc(t.status.replace(/_/g,' '))}</span>
      </div>
      <div class="ctitle">\${esc(t.title)}</div>
      <div class="cmeta">
        <span>\${esc(t.repo||'')}</span><span>\${esc(t.phase||'')}</span><span>\${esc(t.updated||'')}</span>
      </div>
      <button class="launch" data-launch="\${t.id}">▶ Launch</button>
    </div>
  \`).join('');
  el.querySelectorAll('.card').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.dataset.launch) { vsc.postMessage({ type:'launch', id:e.target.dataset.launch }); return; }
      vsc.postMessage({ type:'detail', id:c.dataset.id });
    });
  });
}

function loadData() {
  fetch(SIDECAR + '/api/data').then(r => r.json()).then(d => {
    tickets = (d.tickets||[]).filter(t => !['DONE','DONE_WITH_ERRORS'].includes(t.status));
    render();
  }).catch(() => {});
}

window.addEventListener('message', e => {
  if (e.data.type === 'refresh') loadData();
});

// SSE for live reload signal
const es = new EventSource(SIDECAR + '/api/watch');
es.addEventListener('open', () => {
  document.getElementById('dot').style.background = '#10b981';
  document.getElementById('conn').textContent = 'Live';
});
es.addEventListener('error', () => {
  document.getElementById('dot').style.background = '#f87171';
  document.getElementById('conn').textContent = 'Disconnected';
});
es.addEventListener('message', e => {
  try {
    const ev = JSON.parse(e.data);
    if (ev.event === 'reload') loadData();
  } catch {}
});

loadData();
</script>
</body>
</html>`;
}

function getShellsHtml(sidecarUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(sidecarUrl)}">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:8px; background:#0f0f11; color:#c0c0c0;
  font:12px/1.4 'Segoe UI',system-ui,sans-serif; }
.status-bar { font-size:10px; color:#444; margin-bottom:6px; display:flex; justify-content:space-between; }
.dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; vertical-align:middle; }
.item { padding:7px 8px; border-radius:5px; border:1px solid #1e1e26; background:#111115;
  margin-bottom:5px; cursor:pointer; }
.item:hover { border-color:#2a2a38; }
.it { display:flex; align-items:center; gap:6px; margin-bottom:2px; }
.pid { font-size:10px; color:#444; font-family:monospace; }
.harness { font-size:10px; padding:1px 5px; border-radius:2px; background:#1a1a2a; color:#818cf8; }
.st { font-size:10px; }
.st.running { color:#4ade80; }
.st.pre-fire { color:#fbbf24; }
.st.completed { color:#555; }
.st.failed { color:#f87171; }
.st.paused_rate_limit { color:#fbbf24; }
.ititle { font-size:11px; color:#dfdfdf; }
.imeta { font-size:10px; color:#444; }
.actions { display:flex; gap:4px; margin-top:4px; }
.abtn { padding:2px 8px; border-radius:3px; border:1px solid #2a2a30; background:#111115;
  color:#888; font-size:10px; cursor:pointer; }
.abtn:hover { border-color:#555; color:#ccc; }
.abtn.kill { border-color:#f87171; color:#f87171; }
.abtn.kill:hover { background:#2a0a0a; }
.empty { color:#333; text-align:center; padding:24px 0; font-size:11px; }
</style>
</head>
<body>
<div class="status-bar">
  <span><span class="dot" id="dot" style="background:#f87171"></span><span id="conn">Connecting…</span></span>
  <span id="cnt">—</span>
</div>
<div id="list"></div>
<script>
const vsc = acquireVsCodeApi();
const SIDECAR = '${sidecarUrl}';
let processes = [];

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function dur(startTs) {
  if (!startTs) return '';
  const s = Math.floor((Date.now() - new Date(startTs).getTime()) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  return Math.floor(s/3600) + 'h' + Math.floor((s%3600)/60) + 'm';
}

function render() {
  document.getElementById('cnt').textContent = processes.length + ' processes';
  const el = document.getElementById('list');
  if (!processes.length) { el.innerHTML = '<div class="empty">No active shells</div>'; return; }
  el.innerHTML = processes.map(p => \`
    <div class="item" data-pid="\${p.processId}">
      <div class="it">
        <span class="pid">\${esc(p.processId)}</span>
        <span class="harness">\${esc(p.harness||'')}</span>
        <span class="st \${(p.status||'').replace('-','_')}">\${esc(p.status||'')}</span>
        <span style="margin-left:auto;font-size:10px;color:#444">\${dur(p.startedAt)}</span>
      </div>
      <div class="ititle">\${esc(p.ticketId||'')}</div>
      <div class="imeta">\${esc(p.role||'')} \${esc(p.model||'')}</div>
      <div class="actions">
        <button class="abtn" data-action="mirror" data-pid="\${p.processId}">⬛ Mirror PTY</button>
        \${p.status === 'running' || p.status === 'pre-fire' ? \`
          <button class="abtn" data-action="interrupt" data-pid="\${p.processId}">⌃C Interrupt</button>
          <button class="abtn kill" data-action="terminate" data-pid="\${p.processId}">⏻ Terminate</button>
        \` : ''}
      </div>
    </div>
  \`).join('');

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const pid = btn.dataset.pid;
      const action = btn.dataset.action;
      if (action === 'mirror') { vsc.postMessage({ type:'mirror', processId:pid }); return; }
      if (action === 'interrupt') {
        fetch(SIDECAR + '/api/process/' + pid + '/interrupt', { method:'POST' }).catch(()=>{});
        return;
      }
      if (action === 'terminate') {
        if (confirm('Terminate ' + pid + '?'))
          fetch(SIDECAR + '/api/process/' + pid + '/terminate', { method:'POST' }).catch(()=>{});
        return;
      }
    });
  });
}

function loadData() {
  fetch(SIDECAR + '/api/processes').then(r => r.json()).then(d => {
    processes = d.processes || [];
    render();
  }).catch(() => {});
}

window.addEventListener('message', e => {
  if (e.data.type === 'refresh') loadData();
  if (e.data.type === 'processUpdate') { loadData(); }
});

const es = new EventSource(SIDECAR + '/api/watch');
es.addEventListener('open', () => {
  document.getElementById('dot').style.background = '#10b981';
  document.getElementById('conn').textContent = 'Live';
});
es.addEventListener('error', () => {
  document.getElementById('dot').style.background = '#f87171';
  document.getElementById('conn').textContent = 'Disconnected';
});
es.addEventListener('message', e => {
  try {
    const ev = JSON.parse(e.data);
    if (ev.event === 'process.start' || ev.event === 'process.end' || ev.event === 'process.cleared') loadData();
  } catch {}
});

loadData();
setInterval(loadData, 5000);
</script>
</body>
</html>`;
}

function getAuditHtml(sidecarUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(sidecarUrl)}">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:8px; background:#0f0f11; color:#c0c0c0;
  font:11px/1.5 'Segoe UI',system-ui,sans-serif; }
.filters { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
.fb { padding:2px 7px; border-radius:3px; border:1px solid #2a2a30;
  background:#111115; color:#777; cursor:pointer; font-size:10px; }
.fb.active { border-color:#10b981; color:#10b981; }
.entry { display:flex; gap:6px; padding:4px 0; border-bottom:1px solid #181820; font-size:10px; }
.ts { color:#333; white-space:nowrap; font-family:monospace; font-size:9px; min-width:50px; }
.kind { font-family:monospace; color:#818cf8; white-space:nowrap; font-size:9px; min-width:100px; }
.msg { color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.empty { color:#333; text-align:center; padding:24px 0; font-size:11px; }
</style>
</head>
<body>
<div class="filters" id="filters">
  <button class="fb active" data-k="">All</button>
  <button class="fb" data-k="process">Process</button>
  <button class="fb" data-k="agent">Agent</button>
  <button class="fb" data-k="operator">Operator</button>
  <button class="fb" data-k="budget">Budget</button>
  <button class="fb" data-k="config">Config</button>
</div>
<div id="log"></div>
<script>
const vsc = acquireVsCodeApi();
const SIDECAR = '${sidecarUrl}';
let entries = [], filter = '';

document.querySelectorAll('.fb').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.fb').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); filter = b.dataset.k; render();
}));

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function render() {
  const list = filter ? entries.filter(e => (e.kind||'').startsWith(filter)) : entries;
  const el = document.getElementById('log');
  if (!list.length) { el.innerHTML = '<div class="empty">No entries</div>'; return; }
  el.innerHTML = list.slice(-200).reverse().map(e => \`
    <div class="entry">
      <span class="ts">\${fmt(e.ts)}</span>
      <span class="kind">\${esc(e.kind||'')}</span>
      <span class="msg">\${esc(e.summary||e.message||e.ticketId||'')}</span>
    </div>
  \`).join('');
}

function loadData() {
  fetch(SIDECAR + '/api/audit?limit=200').then(r => r.json()).then(d => {
    entries = d.entries || [];
    render();
  }).catch(() => {});
}

window.addEventListener('message', e => {
  if (e.data.type === 'refresh') loadData();
  if (e.data.type === 'push' && e.data.entry) { entries.push(e.data.entry); render(); }
});

loadData();
setInterval(loadData, 10000);
</script>
</body>
</html>`;
}

function getDetailHtml(sidecarUrl, ticketId, content) {
  const escaped = content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(sidecarUrl)}">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:16px; background:#0f0f11; color:#c0c0c0;
  font:13px/1.6 'Segoe UI',system-ui,sans-serif; max-width:900px; }
h1,h2,h3 { color:#dfdfdf; }
code { font-family:monospace; background:#1a1a20; padding:1px 4px; border-radius:2px; font-size:11px; color:#a0c0ff; }
pre { background:#111118; border:1px solid #1e1e26; border-radius:5px; padding:12px; overflow-x:auto; }
pre code { background:none; padding:0; }
table { border-collapse:collapse; width:100%; }
td, th { padding:5px 8px; border:1px solid #1e1e26; font-size:11px; }
th { background:#111115; }
a { color:#10b981; }
hr { border:none; border-top:1px solid #1e1e26; }
blockquote { border-left:3px solid #2a2a38; margin:0 0 0 8px; padding-left:12px; color:#888; }
.launch-panel { background:#111115; border:1px solid #1e1e26; border-radius:6px;
  padding:12px; margin-bottom:20px; }
.launch-panel h3 { margin:0 0 10px; font-size:13px; color:#dfdfdf; }
.field-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; align-items:center; }
label { font-size:11px; color:#888; min-width:80px; }
select, input[type=text] { background:#0f0f11; border:1px solid #2a2a30; color:#c0c0c0;
  padding:3px 7px; border-radius:3px; font-size:11px; }
.launch-btn { padding:6px 16px; background:#10b98122; border:1px solid #10b981;
  color:#10b981; border-radius:4px; font-size:12px; cursor:pointer; }
.launch-btn:hover { background:#10b98140; }
.status-msg { font-size:11px; color:#fbbf24; margin-top:6px; }
.status-msg.ok { color:#4ade80; }
.md-content { line-height:1.7; }
</style>
</head>
<body>
<div class="launch-panel">
  <h3>▶ Launch Agent — ${ticketId}</h3>
  <div class="field-row">
    <label>Harness</label>
    <select id="f-harness">
      <option value="mock">mock</option>
      <option value="zo">zo</option>
      <option value="claude-code">claude-code</option>
      <option value="codex">codex</option>
      <option value="gemini-cli">gemini-cli</option>
    </select>
    <label>Role</label>
    <input type="text" id="f-role" value="engineering" style="width:120px">
    <label>Model</label>
    <input type="text" id="f-model" value="" placeholder="default" style="width:120px">
  </div>
  <div class="field-row">
    <label>Addendum</label>
    <input type="text" id="f-addendum" value="" placeholder="Optional prompt addendum" style="width:320px">
  </div>
  <div style="display:flex;gap:8px;align-items:center">
    <button class="launch-btn" id="launch-btn">▶ Launch</button>
    <span id="launch-status" class="status-msg" style="display:none"></span>
  </div>
</div>
<div class="md-content" id="md"></div>
<script>
const vsc = acquireVsCodeApi();
const SIDECAR = '${sidecarUrl}';
const TICKET_ID = '${ticketId}';
const RAW = \`${escaped}\`;

// Simple markdown renderer
function md(text) {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/\`\`\`[\\w]*\\n([\\s\\S]*?)\`\`\`/gm, '<pre><code>$1</code></pre>')
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\\n{2,}/g, '<br><br>');
}

document.getElementById('md').innerHTML = md(RAW);

document.getElementById('launch-btn').addEventListener('click', () => {
  const harness = document.getElementById('f-harness').value;
  const role = document.getElementById('f-role').value;
  const model = document.getElementById('f-model').value;
  const addendum = document.getElementById('f-addendum').value;
  const statusEl = document.getElementById('launch-status');
  statusEl.style.display = 'inline';
  statusEl.className = 'status-msg';
  statusEl.textContent = 'Launching…';

  fetch(SIDECAR + '/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: TICKET_ID, harness, role, model, promptAddendum: addendum })
  }).then(r => r.json()).then(d => {
    if (d.status === 'spawned') {
      statusEl.className = 'status-msg ok';
      statusEl.textContent = 'Spawned ' + d.processId;
      vsc.postMessage({ type: 'spawned', processId: d.processId, meta: d.meta });
    } else {
      statusEl.textContent = d.message || d.error || 'Launch failed';
    }
  }).catch(e => {
    statusEl.textContent = 'Error: ' + e.message;
  });
});

window.addEventListener('message', e => {
  // extension host can push status updates here if needed
});
</script>
</body>
</html>`;
}

// ─── Webview providers ────────────────────────────────────────────────────────

class BoardViewProvider {
  constructor() {
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getBoardHtml(getSidecarUrl());

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'detail') openTicketDetail(msg.id);
      if (msg.type === 'launch') showLaunchForTicket(msg.id);
    });
  }

  refresh() {
    this._view?.webview.postMessage({ type: 'refresh' });
  }
}

class ShellsViewProvider {
  constructor() {
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getShellsHtml(getSidecarUrl());

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'mirror') {
        // Extension host opens PTY mirror terminal
        apiGet(`/api/process/buffer?id=${msg.processId}`).then(data => {
          if (data && data.meta) openPtyMirror(msg.processId, data.meta);
        }).catch(() => {});
      }
    });
  }

  refresh() {
    this._view?.webview.postMessage({ type: 'refresh' });
  }
}

class AuditViewProvider {
  constructor() {
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getAuditHtml(getSidecarUrl());
  }

  refresh() {
    this._view?.webview.postMessage({ type: 'refresh' });
  }

  push(entry) {
    this._view?.webview.postMessage({ type: 'push', entry });
  }
}

// ─── Detail webview panel ─────────────────────────────────────────────────────

const openPanels = new Map(); // ticketId -> WebviewPanel

function openTicketDetail(ticketId) {
  if (openPanels.has(ticketId)) {
    openPanels.get(ticketId).reveal();
    return;
  }

  const repoSlug = detectRepoForTicket(ticketId);
  const ticketPath = findTicketPath(ticketId, repoSlug);
  let content = '';
  if (ticketPath) {
    try { content = fs.readFileSync(ticketPath, 'utf8'); } catch {}
  } else {
    content = `# ${ticketId}\n\nTicket file not found locally.\n`;
  }

  const panel = vscode.window.createWebviewPanel(
    'zaf.ticketDetail',
    `ZAF — ${ticketId}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getDetailHtml(getSidecarUrl(), ticketId, content);

  panel.webview.onDidReceiveMessage(msg => {
    if (msg.type === 'spawned' && msg.processId) {
      openPtyMirror(msg.processId, msg.meta || {});
    }
  });

  panel.onDidDispose(() => openPanels.delete(ticketId));
  openPanels.set(ticketId, panel);
}

function showLaunchForTicket(ticketId) {
  openTicketDetail(ticketId);
}

// ─── Ticket file helpers ──────────────────────────────────────────────────────

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders ? folders[0].uri.fsPath : null;
}

function detectRepoForTicket(ticketId) {
  if (ticketId.startsWith('TKT-ZAF-')) return 'zaf';
  return 'zo';
}

function findTicketPath(ticketId, repoSlug) {
  const root = getWorkspaceRoot();
  if (!root) return null;

  const candidates = [
    path.join(root, 'WIP', 'tickets', 'ACTIVE', `${ticketId}.md`),
    path.join(root, 'WIP', 'tickets', 'ARCHIVED', `${ticketId}.md`),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── Gutter decorations ───────────────────────────────────────────────────────

let decorationType = null;

function ensureDecorationType(context) {
  if (decorationType) return;
  const iconUri = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'zaf-icon.svg'));
  decorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: iconUri,
    gutterIconSize: 'contain',
    overviewRulerColor: '#10b981',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    light: { gutterIconPath: iconUri },
    dark: { gutterIconPath: iconUri },
  });
}

function extractFileRefsFromTicket(content) {
  const refs = [];
  // `` `path/to/file.ext` `` or `` `path/to/file.ext:42` ``
  const inlineCode = /`([^`\n]+\.[a-zA-Z]{1,6}(?::\d+)?)`/g;
  let m;
  while ((m = inlineCode.exec(content)) !== null) {
    const raw = m[1].trim();
    const colonIdx = raw.lastIndexOf(':');
    if (colonIdx > 0 && /^\d+$/.test(raw.slice(colonIdx + 1))) {
      refs.push({ filePath: raw.slice(0, colonIdx), line: parseInt(raw.slice(colonIdx + 1), 10) - 1 });
    } else {
      refs.push({ filePath: raw, line: 0 });
    }
  }
  return refs;
}

async function updateDecorations(editor, context) {
  if (!editor) return;
  ensureDecorationType(context);

  const docPath = editor.document.uri.fsPath;
  const root = getWorkspaceRoot();
  if (!root) { editor.setDecorations(decorationType, []); return; }

  const activeDir = path.join(root, 'WIP', 'tickets', 'ACTIVE');
  if (!fs.existsSync(activeDir)) { editor.setDecorations(decorationType, []); return; }

  const decorations = [];

  try {
    const files = await fs.promises.readdir(activeDir);
    const ticketFiles = files.filter(f => f.endsWith('.md'));

    await Promise.all(ticketFiles.map(async tf => {
      const ticketPath = path.join(activeDir, tf);
      let content;
      try { content = await fs.promises.readFile(ticketPath, 'utf8'); } catch { return; }

      const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      let ticketId = path.basename(tf, '.md');
      let title = '';
      if (yamlMatch) {
        for (const line of yamlMatch[1].split('\n')) {
          const ci = line.indexOf(':');
          if (ci === -1) continue;
          const k = line.slice(0, ci).trim();
          const v = line.slice(ci + 1).trim().replace(/^['"]|['"]$/g, '');
          if (k === 'id') ticketId = v;
          if (k === 'title') title = v;
        }
      }

      const refs = extractFileRefsFromTicket(content);
      for (const ref of refs) {
        // Match by file path suffix
        const normalised = ref.filePath.replace(/\\/g, '/');
        const docNorm = docPath.replace(/\\/g, '/');
        if (!docNorm.endsWith('/' + normalised) && !docNorm.endsWith(normalised)) continue;

        const lineNum = Math.max(0, ref.line);
        const safeLine = Math.min(lineNum, editor.document.lineCount - 1);
        const range = new vscode.Range(safeLine, 0, safeLine, 0);
        const hover = new vscode.MarkdownString();
        hover.isTrusted = true;
        hover.appendMarkdown(`**ZAF Active Ticket**\n\n`);
        hover.appendMarkdown(`- **ID**: \`${ticketId}\`\n`);
        hover.appendMarkdown(`- **Title**: ${title}\n`);
        hover.appendMarkdown(`\n[▶ Open Detail](command:zaf.openDetail?${encodeURIComponent(JSON.stringify(ticketId))})`);
        decorations.push({ range, hoverMessage: hover });
      }
    }));
  } catch (err) {
    console.error('[ZAF] Gutter update error:', err);
  }

  editor.setDecorations(decorationType, decorations);
}

// ─── activate ─────────────────────────────────────────────────────────────────

function activate(context) {
  const boardProvider = new BoardViewProvider();
  const shellsProvider = new ShellsViewProvider();
  const auditProvider = new AuditViewProvider();

  const views = { board: boardProvider, shells: shellsProvider, audit: auditProvider };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('zaf.board', boardProvider),
    vscode.window.registerWebviewViewProvider('zaf.shells', shellsProvider),
    vscode.window.registerWebviewViewProvider('zaf.audit', auditProvider),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('zaf.openPanel', () => {
      vscode.commands.executeCommand('workbench.view.extension.zaf-explorer');
    }),

    vscode.commands.registerCommand('zaf.refresh', () => {
      boardProvider.refresh();
      shellsProvider.refresh();
      auditProvider.refresh();
      vscode.window.showInformationMessage('ZAF: Refreshed');
    }),

    vscode.commands.registerCommand('zaf.launchAgent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('ZAF: No active editor'); return; }
      const root = getWorkspaceRoot();
      if (!root) { vscode.window.showWarningMessage('ZAF: No workspace'); return; }
      const relPath = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, '/');
      // Look for tickets referencing this file
      const activeDir = path.join(root, 'WIP', 'tickets', 'ACTIVE');
      if (!fs.existsSync(activeDir)) { vscode.window.showWarningMessage('ZAF: No active tickets dir'); return; }
      const matches = [];
      try {
        const files = await fs.promises.readdir(activeDir);
        const ticketFiles = files.filter(f => f.endsWith('.md'));

        await Promise.all(ticketFiles.map(async tf => {
          const content = await fs.promises.readFile(path.join(activeDir, tf), 'utf8');
          const refs = extractFileRefsFromTicket(content);
          if (refs.some(r => relPath.endsWith(r.filePath.replace(/\\/g, '/')))) {
            const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
            let id = path.basename(tf, '.md');
            if (yamlMatch) { for (const l of yamlMatch[1].split('\n')) { if (l.startsWith('id:')) id = l.slice(3).trim(); } }
            matches.push(id);
          }
        }));
      } catch {}
      if (!matches.length) {
        vscode.window.showWarningMessage('ZAF: No active ticket references this file');
        return;
      }
      if (matches.length === 1) { openTicketDetail(matches[0]); return; }
      vscode.window.showQuickPick(matches, { placeHolder: 'Select ticket to launch' }).then(id => {
        if (id) openTicketDetail(id);
      });
    }),

    vscode.commands.registerCommand('zaf.openDetail', (ticketId) => {
      openTicketDetail(ticketId);
    }),
  );

  // Gutter decorations
  ensureDecorationType(context);
  let activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) updateDecorations(activeEditor, context);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      activeEditor = editor;
      if (editor) updateDecorations(editor, context);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (activeEditor && event.document === activeEditor.document) {
        updateDecorations(activeEditor, context);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      if (activeEditor) updateDecorations(activeEditor, context);
    }),
  );

  // SSE connection at extension-host level (drives PTY mirror)
  connectSSE(context, views);

  // Auto-start sidecar if configured
  if (vscode.workspace.getConfiguration('zaf').get('autoStartSidecar')) {
    const root = getWorkspaceRoot();
    if (root) {
      const serverPath = path.join(root, '..', 'zaf', 'dashboard', 'server.js');
      if (fs.existsSync(serverPath)) {
        const terminal = vscode.window.createTerminal('ZAF Sidecar');
        terminal.sendText(`node "${serverPath}"`);
        terminal.show(false);
      }
    }
  }
}

function deactivate() {
  if (sseReq) { try { sseReq.destroy(); } catch {} }
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
}

module.exports = { activate, deactivate };
