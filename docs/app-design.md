# ZAF Desktop App Design Specification

This specification outlines the technical design, packaging layout, and desktop integration specs for the **ZO Agentic Framework (ZAF) Desktop App**. 

ZAF Desktop is a lightweight, local-first utility designed to host the control dashboard, execute background file watcher heartbeats, and provide system-level telemetry alerts.

---

## 📱 Desktop Integration Stack

To preserve ZAF's core philosophy (low footprint, local-first, native performance), the desktop app is built using **Tauri** rather than Electron.

```
┌────────────────────────────────────────────────────────┐
│                    ZAF Desktop UI                      │
│                  (HTML5 / CSS / JS)                    │
├────────────────────────────────────────────────────────┤
│                       Tauri Core                       │
│             (Webview2 / Rust System API)               │
├────────────────────────────────────────────────────────┤
│                     Background Core                    │
│             (Rust Daemon + Node Server Sidecar)        │
└────────────────────────────────────────────────────────┘
```

### Stack Components:
1.  **Frontend Interface**: Compiles ZAF's existing HTML5, CSS Variables, and Vanilla JS SPA views (Overview, Board, Graph, Archive, Programme) directly into the app package.
2.  **App Core (Rust)**: Manages window lifecycle, handles local OS APIs, manages the system tray interface, and spawns native subshells.
3.  **Local Server Sidecar (Node.js)**: Tauri bundles ZAF's Node-based HTTP + SSE server (`server.js` and `parse.js`) as a packaged **sidecar binary**, running quietly in the background without needing global terminal execution.

---

## 🛠 System Architecture & Lifecycle

### 1. Startup Protocol
1.  On app launch, Tauri's Rust entry point (`main.rs`) initializes and checks if port `4242` is available on `127.0.0.1`.
2.  Tauri spawns the Node.js `server.js` sidecar process, passing configurations (such as the default repositories root `01_Repos/`) as environment variables.
3.  The Webview window boots, displaying the loading screen, and connects to the local HTTP endpoint `/api/data` and the SSE live watcher at `/api/watch`.

### 2. System Tray & Window Lifecycle
*   **System Tray Icon**: ZAF runs primarily as a quiet **System Tray Utility** in the Windows Taskbar.
*   **Tray Options**:
    *   `Show Dashboard` (opens the main Webview window).
    *   `Trigger Parse Sweep` (forces an immediate AST parse across all repos).
    *   `Restart Telemetry Server` (re-initializes the Node sidecar).
    *   `Settings` (allows updating default repos-root, theme selections, and budget bounds).
    *   `Exit` (terminates all background processes and child subprocesses safely).
*   **Minimize-to-Tray**: Closing the main window hides it to the system tray instead of terminating, ensuring the file watcher heartbeat remains active 24/7.

---

## 🖥 User Interface Design System

The app window features ZAF's premium **linear-dark slate design system** with native title bars customized for an integrated, premium desktop experience.

```
┌────────────────────────────────────────────────────────────────────────┐
│  ZO ZAF Control Panel                                           [-] [x]│
├───────────────┬────────────────────────────────────────────────────────┤
│ ◈ Overview    │  Unified Repository Board                              │
│ ⊞ Programmes  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│ ▦ Board       │  │ OPEN          │ │ IN_PROGRESS   │ │ BLOCKED       │ │
│ ⬡ Dependency  │  ├───────────────┤ ├───────────────┤ ├───────────────┤ │
│ ⏳ Archive    │  │ TKT-ZAF-0004  │ │ TKT-ZO-0167   │ │ TKT-ZO-0067   │ │
│               │  │ [WS-CLI]      │ │ [WS-SHELL]    │ │ [WS-ASSIST]   │ │
├───────────────┤  └───────────────┘ └───────────────┘ └───────────────┘ │
│ ● Telemetry:  │                                                        │
│   Connected   │  Active Agent Session Logs:                            │
│               │  > claude-code: Running TKT-ZO-0167 [9 turns/20 max]   │
└───────────────┴────────────────────────────────────────────────────────┘
```

### Key UI Integrations:
1.  **Window Native Customization**:
    *   Borderless glassmorphism acrylic panels (`window.set_decorations(false)`).
    *   Draggable header region (`data-tauri-drag-region`).
2.  **Telemetry Live Feed**:
    *   Pulsing green indicator dot in the sidebar showing active SSE connection state.
    *   A bottom console drawer showcasing active subshell terminal executions and turn-budget counts in real-time.
3.  **Interactive Notification Panels**:
    *   Tauri triggers **native Windows OS notifications** when:
        *   A ticket status updates on disk.
        *   A model loop budget incident (soft/hard) occurs.
        *   A dependency is resolved, unblocking a pending ticket.

---

## 📦 Tauri Packaging Configuration

The Tauri configuration file (`src-tauri/tauri.conf.json`) bundles ZAF into a standalone desktop utility:

```json
{
  "build": {
    "distDir": "../dashboard",
    "devPath": "http://localhost:4242"
  },
  "package": {
    "productName": "ZAFControl",
    "version": "1.0.0"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "shell": {
        "all": false,
        "execute": true,
        "sidecar": true
      },
      "notification": {
        "all": true
      }
    },
    "bundle": {
      "active": true,
      "category": "DeveloperTool",
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/icon.ico"
      ],
      "targets": ["msi", "nsis"]
    },
    "systemTray": {
      "iconPath": "icons/icon.ico",
      "iconAsTemplate": true
    },
    "windows": [
      {
        "title": "ZO Agentic Framework Control",
        "width": 1200,
        "height": 800,
        "resizable": true,
        "fullscreen": false,
        "transparent": true,
        "decorations": false
      }
    ]
  }
}
```
