# ZAF IDE Extension Specification

This specification outlines the technical design, sidebar integration layout, terminal multiplexing protocols, and editor-level telemetry specs for the **ZAF IDE Extension** (built for standard VSCode and fork editors like Antigravity and Cursor).

---

## 🎨 IDE Sidebar Panel Integration

Rather than forcing you to switch windows between your code editor and a web browser, the extension embeds ZAF's core visual surfaces directly into the **primary editor sidebar**.

```
┌──────────────────────────┐
│ EXTENSION SIDEBAR PANEL  │
├──────────────────────────┤
│ ◈ Overview               │
│   ● Active tickets: 110  │
├──────────────────────────┤
│ ▦ Active Tickets Board   │
│   ▼ IN_PROGRESS          │
│     TKT-ZO-0167          │
│     TKT-ZAF-0004         │
│   ▼ BLOCKED              │
│     TKT-ZO-0067          │
├──────────────────────────┤
│ ⬡ Active Dependency Gut  │
│   [Graph Visual Overlay] │
├──────────────────────────┤
│ ▶ Launch Local Harness   │
│   [ Claude ] [ Codex ]   │
└──────────────────────────┘
```

### Components:
1.  **Kanban Sidebar View**: A high-performance Webview panel rendering a compact, vertically stacked list of active, blocked, and in-progress tickets.
2.  **Context-Aware Action Buttons**: Hovering over any ticket in the sidebar displays control buttons:
    *   `▶ Run` (spawns the targeted CLI harness pre-seeded with this ticket's files).
    *   `⚙ Configure` (edit ticket metadata front-matter).
    *   `✓ Resolve` (marks status as `DONE` and automatically triggers archiving).
3.  **Active Telemetry Status Bar**: Embeds a small, green pulsing indicator icon at the bottom-right of the IDE Status Bar showing ZAF’s watch-server connection state and active agent subshell execution counts.

---

## 🔀 Terminal Multiplexing & Sovereign Harness Spawning

The core function of the extension is to manage the **spawning and orchestration of sovereign agent CLI harnesses** inside VSCode's native Terminal pane.

```
┌────────────────────────────────────────────────────────┐
│ Editor Pane (app.js / style.css)                       │
│                                                        │
├────────────────────────────────────────────────────────┤
│ TERMINAL PANE                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ > zo run TKT-ZAF-0004 --harness claude             │ │
│ │ [ZAF] Staging 8 active files for TKT-ZAF-0004...    │ │
│ │ [ZAF] Spawning native Claude Code CLI harness...     │ │
│ │                                                    │ │
│ │ claude-code (v0.2.1)                               │ │
│ │ > Active files mounted. Native skills unblocked.   │ │
│ │ > Claude Code: What should we build?               │ │
│ └────────────────────────────────────────────────────┘ │
│ [Terminal Tabs: ZAF Core] [ZAF-Claude-TKT-0004] [+]    │
└────────────────────────────────────────────────────────┘
```

### Execution Flow:
1.  When you click the `▶ Run` icon on ticket `TKT-ZAF-0004`, the extension uses VSCode's native API: `vscode.window.createTerminal`.
2.  It creates a dedicated terminal tab titled `ZAF-Claude-TKT-0004`.
3.  It automatically injects the ZAF CLI run execution command into the terminal session:
    ```bash
    zo run TKT-ZAF-0004 --harness claude
    ```
4.  The terminal subshell launches the raw native CLI (`npx @anthropic-ai/claude-code`) inside its own sovereign environment, giving the user access to all native model configurations and features.
5.  **Interactive Control**: Because it is running inside the editor’s standard terminal interface, the operator can interact directly with the agent, review inputs, and execute command pipelines.

---

## 🔴 Editor Gutter Indicators (Active Code Telemetry)

To bring ZAF's dependency mapping directly into the code writing workspace, the extension implements **Active Code Gutter Indicators**:

```
14: export function renderBoard(container) {
15:   const tickets = getFilteredTickets();
16:   const active  = getActiveTickets();
17: 
18: 🔴 [TKT-ZO-0167 / Blocks: 2 tickets]
19:   const workstreams = [...new Set(active.map(t => t.workstream).filter(Boolean))].sort();
20:   const phases      = [...new Set(active.map(t => t.phase).filter(Boolean))].sort();
```

### Mechanics:
1.  When you open a code file that is currently listed under an active ticket's file array or has active blockers:
2.  The extension places a customized **gutter icon** (colored dot or ticket ID tag) on the left-side gutter of the editor next to line numbers.
3.  Hovering over the gutter icon displays a rich hover panel:
    *   The active ticket title and ID.
    *   The assigned agent role.
    *   The current status (`IN_PROGRESS` or `BLOCKED` by other files).
    *   The last Handoff Log summary.
4.  This creates a visual bridge, warning developers if they are editing lines of code that are actively locked or being processed by an running agent session.

---

## ⚙ Extension Configuration (`package.json`)

The extension's configuration manifest integrates all ZAF variables seamlessly:

```json
{
  "name": "zaf-control",
  "displayName": "ZO Agentic Framework Control",
  "description": "IDE Control Panel & Telemetry for the ZAF multi-agent harness overlay.",
  "version": "1.0.0",
  "publisher": "nassau-1",
  "engines": {
    "vscode": "^1.80.0"
  },
  "categories": [
    "Other"
  ],
  "activationEvents": [
    "onView:zaf-sidebar-panel"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "zaf-control-explorer",
          "title": "ZAF Control",
          "icon": "resources/zaf-icon.svg"
        }
      ]
    },
    "views": {
      "zaf-control-explorer": [
        {
          "type": "webview",
          "id": "zaf-sidebar-panel",
          "name": "ZO Active Board"
        }
      ]
    },
    "configuration": {
      "title": "ZO Agentic Framework",
      "properties": {
        "zaf.reposRoot": {
          "type": "string",
          "default": "~/Workspace/01_Repos",
          "description": "Absolute path to local repositories root folder."
        },
        "zaf.defaultHarness": {
          "type": "string",
          "enum": ["claude", "codex", "gemini"],
          "default": "claude",
          "description": "Default sovereign CLI harness to use during execution."
        },
        "zaf.budgetHardStopCents": {
          "type": "integer",
          "default": 5000,
          "description": "Hard stop cost ceiling in cents for safety loops."
        }
      }
    }
  }
}
```
