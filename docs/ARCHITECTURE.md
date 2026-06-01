# Architecture

This document describes the internal architecture of ZAF, the Zero-to-one Agent Framework. The README keeps a product-led overview; this file holds the implementation-heavy detail.

## System overview

ZAF is composed of five main parts:

- a Node.js control server (HTTP + SSE)
- a vanilla-JS dashboard SPA
- a Node.js CLI that launches agent harness subprocesses
- a Tauri v2 desktop wrapper
- a VSCode extension named `ZAF Control`

The file system is the source of truth. Tickets, programmes, audit logs, agent configs and extracted skills are stored as plain files in the workspace.

## Control server

`dashboard/server.js` is a Node.js HTTP and SSE server that listens on port 4242.

Responsibilities:

- Multi-repo ticket scanning. Watches workspace repos and surfaces tickets into the unified dashboard.
- PTY-based agent subprocess spawning. Launches harness processes in pseudo-terminals and streams stdout/stderr in real time.
- SSE live push. Pushes events to all connected dashboard clients with sub-second latency.
- JSONL audit log. Every agent event is appended to a structured JSONL audit trail.
- Repo context generation. A static analysis pass writes `CODEBASE.md` and injects it into every agent seed prompt.
- Agent Marketplace API. `GET /api/marketplace` and `POST /api/marketplace/import` import agent packs from a git URL.
- Loop detection. A rolling 20-event window emits an `agent.loop` audit event and offers auto-kill when a loop is detected.
- Skill extraction. `GET /api/process/skills` and `POST /api/skill/save` run pattern analysis over the classified PTY event stream and save extracted skills as `.zaf-skills/*.zaf-skill.md`.
- Agent config persistence. Reads and writes `config.json` for per-agent settings.

## Dashboard

`dashboard/app.js` is a single-page application of roughly 5,000 lines of vanilla JavaScript with full client-side routing.

Views:

| View | Description |
|---|---|
| Overview | Programme health, active agent count, recent audit events |
| Programme | Programme-level goals and phase status |
| Board | Kanban board across ticket states (OPEN, ACTIVE, BLOCKED, DONE) |
| Fleet | Live agent roster, per-agent console, harness status |
| Dependency Graph | Force-directed SVG graph of ticket blockers and ancestry |
| Archive | Closed tickets and historical runs |
| Codebase Map | Force-directed SVG file graph generated from static analysis; click-to-inspect symbols; "Generate CODEBASE.md" button |
| Control Center | 5-tab panel: Ticket Builder, Agent Editor, Marketplace, Telemetry, CLI Hub |
| Org Builder | Define and edit agent roles and team structure |
| Audit Log | Searchable, filterable JSONL audit event viewer |

The multi-console terminal panel is powered by xterm.js PTY mirrors. Each spawned process gets a dedicated console tab with full output replay.

`dashboard/index.html` is the app shell. It loads xterm.js, marked.js and the SPA entry point.

`dashboard/style.css` and `dashboard/style-paperclip.css` define a dark design system based on CSS custom properties.

## CLI

`cli/zaf.js` is the canonical CLI entrypoint.

Subcommands:

- `zaf ticket status <TKT-ID>`
- `zaf ticket create "<title>"`
- `zaf run <role> --ticket <TKT-ID> [--harness <name>] [--model <model>] [--reasoning <level>] [--heartbeat <seconds>]`

The CLI builds and injects a transient seed prompt at `.zaf-skill.md` and manages harness subprocess lifecycle. It coordinates with the control server when launched from the dashboard.

## Agent harnesses

The CLI's `run` command accepts a `--harness` flag that selects the agent execution environment.

| Harness | Description |
|---|---|
| `mock` | Built-in simulator. Generates synthetic PTY output for testing dashboards, loop detection and skill extraction without running a real AI agent. |
| `claude-code` | Spawns a Claude Code CLI session scoped to the ticket's allowed paths and seed prompt. |
| `codex` | OpenAI Codex CLI harness with ZAF seed-prompt injection. |
| `gemini-cli` | Google Gemini CLI harness. |
| custom | Any harness can be defined in the Control Center, Agent Editor UI. Custom harnesses specify the binary path, argument template and environment variables. |

Interactive harnesses (`claude-code`, `codex`, `gemini-cli`) require a real TTY. When launched from the dashboard subshell, the CLI prints an instructional banner instead of silently exiting.

## Ticket system

Tickets live under `WIP/tickets/` and follow the ZAF ticket standard documented in [`TICKET-STANDARD.md`](TICKET-STANDARD.md).

```text
WIP/
├── tickets/
│   ├── TICKETS.md       Master index: status, priority, blocked_by
│   ├── ACTIVE/          Tickets currently in progress
│   ├── OPEN/            Queued tickets ready to be picked up
│   ├── BLOCKED/         Tickets with unresolved blockers
│   └── DONE/            Completed tickets
└── programmes/          Programme-level goal documents
```

Each ticket file contains a YAML frontmatter metadata header, a goal statement, acceptance criteria, scope boundaries and a Handoff Log. The Handoff Log is append-only and acts as the live state for multi-session work. The last entry is the current state.

The Board view renders tickets from this directory structure. The Dependency Graph derives blocker edges from `blocked_by` fields in ticket frontmatter.

## Audit log and telemetry

Every harness event is appended to a JSONL audit log. The dashboard streams events over SSE in under one second. The Audit Log view exposes search and filter over the JSONL stream.

## Codebase map

A pure-JS static analysis pass (no external dependencies) builds a force-directed SVG file graph of the active repo. Nodes are files. Edges represent imports, references and ticket associations. Click any node to inspect its exported symbols. The "Generate CODEBASE.md" button writes a structured context document that is automatically injected into every agent seed prompt.

## Loop detection

A rolling 20-event window monitors each agent's PTY stream for repetitive patterns. When a loop is detected, the affected console tab shows a pulsing badge. The operator can acknowledge it or trigger an auto-kill of the subprocess. The detection event is written to the audit log as `agent.loop`.

## Skill extraction

After a process completes, pattern analysis runs over the classified PTY event stream to identify reusable skills demonstrated during the session. An "Extract skill" button appears on completed processes. Extracted skills are saved as `.zaf-skills/*.zaf-skill.md` and are auto-injected into the seed prompts of subsequent agent runs.

## Agent marketplace

Agent packs can be imported from any git URL directly from the Control Center, Marketplace tab. Two pack formats are supported:

- Format A: individual `.md` files with YAML frontmatter defining role, skills and directives.
- Format B: `agents.json` manifest listing multiple agent definitions.

Operators preview and select individual agents before importing. Imported agents can be duplicated to local config for customisation. All imported packs are tracked so re-imports are idempotent.

## VSCode extension

The `extension/` directory contains the `ZAF Control` VSCode extension.

It contributes:

- an activity bar container with three webviews: Board, Active Shells and Audit Log
- commands: open panel, launch agent on the current ticket, refresh
- configuration: sidecar URL, auto-start, default harness

See [`EXTENSION-GUIDE.md`](EXTENSION-GUIDE.md) for setup and usage.

## Tauri desktop wrapper

`src-tauri/` contains the Tauri v2 wrapper. Features:

- system tray icon
- minimise-to-tray
- Node sidecar management
- native OS notifications for sweep completions and agent alerts

## Repository layout

```text
zaf/
├── README.md
├── package.json
├── cli/
│   ├── zaf.js                 Canonical CLI entrypoint
│   └── test-harness.js        Automated harness and telemetry tests
├── dashboard/
│   ├── server.js              HTTP + SSE control server (port 4242)
│   ├── app.js                 Vanilla-JS SPA
│   ├── index.html             App shell
│   ├── style.css              Dark design system
│   ├── style-paperclip.css    Paperclip design layer
│   └── package.json
├── docs/
│   ├── ARCHITECTURE.md
│   ├── QUICKSTART.md
│   ├── ROADMAP.md
│   ├── CHANGELOG.md
│   ├── TICKET-STANDARD.md
│   ├── EXTENSION-GUIDE.md
│   ├── agent-taxonomy.md
│   ├── app-design.md
│   ├── cli-design.md
│   ├── coo-spec.md
│   ├── extension-design.md
│   ├── programme-standard.md
│   └── session-bootstrap.md
├── extension/
│   ├── package.json           ZAF Control extension manifest
│   ├── extension.js
│   └── resources/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       └── lib.rs
├── assets/
│   └── screenshots/           Placeholders for future screenshots
├── examples/
│   └── demo-project/          Minimal demo runnable with the mock harness
└── WIP/
    ├── tickets/
    └── programmes/
```
