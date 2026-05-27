# ZO.AF: from Zero to One Agentic Framework

> **The Control Plane for "Zero to One" (ZO.AF) Autonomous & Multi-Agent Teams.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Local First](https://img.shields.io/badge/Local--First-Yes-brightgreen)](#)
[![Stack: Node.js / Vanilla JS](https://img.shields.io/badge/Stack-Node.js%20%2F%20Vanilla%20JS-blue)](#)

Zero to One Agentic Framework (ZO.AF) is a self-hosted, local-first agentic operating system designed to coordinate, run, and visualize teams of autonomous AI agents. Rather than treating agents as simple chatbot conversation partners, ZO.AF establishes a structured control plane—treating agents as scheduled employees with defined roles, clear goal alignment, and deep directory-aware dependency tracking.

This repository contains the core visualiser, parser, and native live-telemetry server for ZO.AF.

---

## ◈ Core Philosophy: From Zero to One (ZO.AF)

Current AI agent frameworks often struggle to scale beyond single-turn inputs or isolated scripts, resulting in runaway costs or "agent drift" (doing busywork instead of the target goal). 

ZO.AF operates on a different set of assumptions:
1. **Agents as Employees**: Agents have specific roles (e.g., SRE, Sourcing, Intelligence, Design), defined skillsets, and scheduled heartbeats.
2. **Directory-First State**: Your filesystem is the database. State, ticket definitions, and logs are kept in markdown-based task directories, preventing vendor lock-in.
3. **Goal-Aware Dependency Graph**: Tasks have clear goal ancestries. Blockers and edges are mapped so agents understand the *why* and *what* of their work and never run out of sync.

---

## ⊞ Core Features (Current Release)
 
### 1. Standalone Multi-Repo Auto-Discovery
ZO.AF does not rely on a heavy database to monitor your organization. Instead, the native parser (`parse.js`) dynamically scans your development space (`01_Repos/`) to auto-discover active projects, scheduled tasks, and agent programs on the fly. 
 
### 2. SSE Live Telemetry Control Server
A lightweight, zero-dependency Node.js control server (`server.js`) handles HTTP requests and establishes a persistent **Server-Sent Events (SSE)** telemetry stream. The server:
* Monitors directory changes across all your repositories in real-time.
* Pushes instant hot-reload signals to connected browsers.
* Ensures the dashboard updates in **under 1 second** of any ticket or state change.
 
### 3. ZAF CLI & Prompt Harness (`cli/zo.js`)
A command-line control plane that coordinates, scaffolds, and launches agent operations:
*   **Dynamic Taxonomy Parser**: Parses assigned roles (`docs/agent-taxonomy.md`) to dynamically inject exact personas, directives, and scoping bounds into `.zaf-skill.md`.
*   **Directory Write Guards**: Imposes strict writable boundaries inside `.zaf-skill.md` to restrict AI agent harness processes to allowed paths.
*   **Turn Telemetry Tracker**: Scans stdout streams to verify and monitor turn budget thresholds, safely auto-terminating drifting agent subshells.
*   **File Status Sync Watcher**: Automatically polls active tickets to cleanly terminate subprocess execution once tickets transition to a `DONE` state.
*   **Automated Validation Suite**: Core CLI logic is fully covered by our automated unit-testing runner (`cli/test-harness.js`).
 
### 4. Tauri Desktop Overlay (`src-tauri/`)
Converts the ZO.AF dashboard and telemetry services into a lightweight standalone utility:
*   **Rust System Tray**: Native taskbar integration supporting quick telemetry server restarts, parse sweeps, and settings panels.
*   **Minimize-to-Tray**: Configured hide events on window close requests to keep the utility running as a quiet background service.
*   **Native Windows Notifications**: Integrates native OS alerts via `tauri-plugin-notification` to notify developers during sweep completions, server boots, or agent alerts.
 
### 5. IDE Extension Integration (`extension/`)
Brings ZAF's tickets, telemetry status cards, and launcher panels directly into standard editors:
*   **Kanban View Sidebar Container**: Renders vertically stacked columns and detail overlays inside standard VSCode and specialized forks (Antigravity/Cursor).
*   **Terminal Tab Multiplexing**: Implements click-to-run subshell hooks that create dedicated terminals mapping directly to live agent tasks.
*   **Gutter Active Indicators**: Gutter warning icons visually flag code files mapped to active ticket scopes.
 
---
 
## 📂 Repository Structure
 
```
zo-agentic-framework/
├── .gitignore            # Ignores generated data.json, node_modules, and internal WIP tracking
├── README.md             # This document
├── package.json          # Main package configuration and scripts
├── cli/                  # ZAF command-line control plane
│   ├── zo.js             # CLI entrypoint with subshell harness and role taxonomy parsing
│   └── test-harness.js   # Automated telemetry and harness test suite
├── dashboard/            # Standalone visualizer & control server
│   ├── server.js         # Native HTTP & SSE telemetry server
│   ├── parse.js          # File-based multi-repo task parser
│   ├── app.js            # Frontend SPA logic (routing, interactive graph, SSE listener)
│   ├── style.css         # Premium Linear-inspired dark design system
│   ├── index.html        # App shell markup
│   └── package.json      # Node.js dependencies (gray-matter, chokidar, marked)
├── src-tauri/            # Tauri Desktop Application wrapper (Rust system tray & sidecars)
│   ├── Cargo.toml        # Rust package dependencies and configuration
│   ├── tauri.conf.json   # Tauri configuration, assets, and sidecar mapping
│   └── src/
│       ├── main.rs       # Rust app launcher
│       └── lib.rs        # Tauri tray menus, minimize events, and native OS notifications
└── extension/            # VSCode / Antigravity IDE Extension integration
    ├── package.json      # Manifest, configuration settings, and sidebar views containers
    ├── extension.js      # Terminal multiplexing and gutter indicators logic
    └── resources/        # Gutter decorators and custom assets
```
 
---
 
## ⚡ Quick Start
 
### 1. Requirements
* [Node.js](https://nodejs.org/) (v18 or higher)
* NPM
* [Rust/Cargo](https://www.rust-lang.org/) (only required if building/compiling the native Tauri app locally)
 
### 2. Installation
Clone the repository and install the dependencies for the dashboard:
```bash
cd dashboard
npm install
```
 
### 3. Running the Telemetry Server
Start the local control server:
```bash
npm start
# or: node server.js
```
The server will start on port `4242` and begin watching the workspace directories for updates.
 
### 4. Running the ZAF CLI
You can execute tasks, query status, or scaffold new tickets via the ZAF CLI:
```bash
# Display general help
node cli/zo.js
 
# Query the status of an active ticket
node cli/zo.js ticket status TKT-ZAF-0005
 
# Scaffold and index a brand new ticket in TICKETS.md
node cli/zo.js ticket create "Implement database auth schema"
 
# Spin up a sovereign subprocess CLI harness
node cli/zo.js run engineering --ticket TKT-ZAF-0006 --harness mock
```
 
### 5. Running the Automated Harness Tests
Validate prompt harvesters, dynamic taxonomy builders, and turn telemetry budgets:
```bash
node cli/test-harness.js
```
 
---
 
## 🛠 Tech Stack
* **Backend**: Node.js, `chokidar` (file system watcher), `gray-matter` (front-matter parser)
* **Desktop Shell**: Rust, Tauri v2, `tauri-plugin-notification`
* **IDE Extension**: VSCode Extension API, JavaScript, CSS, HTML Webview panels
* **Frontend**: Vanilla HTML5, CSS3 Custom Properties (CSS variables), Vanilla ES6 JavaScript
* **Visualizations**: Direct SVG elements rendered on a native canvas (no heavy graph frameworks needed)
* **Markdown Rendering**: `marked.js`
 
---
 
## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
 
## 👤 Author
**Enzo Terrier**
* GitHub: [@nassau-1](https://github.com/nassau-1)
