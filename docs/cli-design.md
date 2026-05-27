# ZAF CLI Design Specification

This specification outlines the technical design, command interfaces, stdin/stdout subshell hooks, and standard prompt wrappers for the **ZAF CLI Tool** (`zo`).

---

## 🛠 Command Line Interface Specifications

The ZAF CLI is a lightweight Node.js executable script located at `cli/zo.js`. It interacts directly with the local Markdown-based filesystem database and manages sovereign shell subprocesses.

### Core Command Set:

#### 1. `zo run <agent-role> --ticket <TKT-ID> [--harness <cli>]`
Spawns the targeted sovereign CLI tool inside a controlled subshell context.
*   **Parameters**:
    *   `<agent-role>`: Targeted role profile (e.g. `engineering`, `sre`, `security`) from `docs/agent-taxonomy.md`.
    *   `<TKT-ID>`: The specific ticket being executed.
    *   `--harness`: The native tool subshell format to use (default: `claude` -> spawns `npx @anthropic-ai/claude-code`).
*   **Execution Behavior**:
    1.  Validates that `<TKT-ID>` exists under `WIP/tickets/ACTIVE/`.
    2.  Assembles task description, context files, and previous handoff logs.
    3.  Writes a transient `.zaf-skill.md` instructions file into the workspace root.
    4.  Spawns the native CLI harness process using Node's `spawn` API.

#### 2. `zo ticket create "<title>" [--workstream <ws>] [--phase <p>]`
Scaffolds a new, properly structured Markdown task ticket.
*   **Parameters**:
    *   `"<title>"`: Concise title of the task.
    *   `--workstream`: Targeted workstream prefix (default: `none`).
    *   `--phase`: Phase gate allocation.
*   **Execution Behavior**:
    1.  Increments the next ticket sequence ID parsed from `WIP/tickets/TICKETS.md`.
    2.  Creates a new Markdown file at `WIP/tickets/ACTIVE/TKT-ZAF-[NUMBER].md` based on `TICKET-TEMPLATE.md`.
    3.  Appends the new ticket entry to the `Active Tickets` table inside `TICKETS.md` automatically.

#### 3. `zo ticket status <TKT-ID>`
Inspects the metadata and status history of a specific task.
*   **Execution Behavior**:
    1.  Reads the YAML front-matter of the targeted ticket file on disk.
    2.  Prints a clean, formatted terminal summary of the ticket status, priority, blocks mapping, and the last handoff entry.

---

## 🔀 Subprocess Subshell Harness Contract

To spawn native CLI tools safely and allow them to interact directly with the developer, ZAF manages the subprocess terminal connection using standard **Streams Multiplexing**:

```
[ User Input / Keyboard ] ──► [ ZAF Subshell Wrapper ] ──► [ Native CLI stdin ]
                                                                 │
                                                                 ▼
[ User Terminal / Gutter ] ◄── [ ZAF Streams Parser ] ◄─── [ Native CLI stdout ]
```

1.  **Piped Terminal Stream**: ZAF spawns the subprocess with `stdio: ['inherit', 'pipe', 'pipe']`. Standard input (keyboard input) passes directly to the native tool, ensuring interactive flags and commands like `/goal` remain fully responsive.
2.  **Output Stream Monitoring**:
    *   ZAF pipes standard output and standard error, scanning chunks in real time for specific triggers or token events.
    *   It measures loop turns (the number of commands processed by the native tool). If turns cross the ticket's loop threshold, ZAF intercepts execution, writes a local pause notification, and forces a graceful exit to prevent infinite loops.
3.  **Graceful Termination**: On crash or exit, ZAF captures the process's exit signal, parses whether the run succeeded, writes log excerpts, and removes the transient `.zaf-skill.md` file from the workspace.

---

## 📄 Standard ZAF Prompt Harness Blueprint (`.zaf-skill.md`)

Before launching any native tool, ZAF writes a temporary `.zaf-skill.md` file to the workspace. This serves as the **"Sovereign Harness Harness"**—instructing the native AI assistant on how to behave deterministically within the ZAF task system.

### Skill Blueprint Content:
```markdown
# ZAF HARNESS SYSTEM SKILL

> **Warning to Assistant**: You are executing under the ZO Agentic Framework (ZAF) control plane. You must strictly follow these operational constraints.

## 1. Active Task Context
*   **Target Ticket ID**: ${ZAF_TICKET_ID}
*   **Target Repository**: ${ZAF_REPO_NAME}
*   **Assigned Role Profile**: ${ZAF_AGENT_ROLE}

## 2. Operational Constraints
1.  **Ticket State Modification**:
    *   Do not delete ticket files.
    *   To complete this task, you must rewrite the metadata front-matter status at the top of `WIP/tickets/ACTIVE/${ZAF_TICKET_ID}.md` from `status: IN_PROGRESS` to `status: DONE`.
2.  **Standard Handoff Logging**:
    *   Before you finish your execution, you MUST append a new chronological log entry to the `## Handoff Log` at the bottom of the active ticket.
    *   Format: `- YYYY-MM-DD | ${ZAF_AGENT_ROLE} | DONE — [Your work description and remaining steps]`.
3.  **Strict File Scoping**:
    *   You are only permitted to write or modify files under the target repository folder.
    *   System files, vault secrets, and root settings are completely read-only.
4.  **No Hallucinations**:
    *   If you encounter a missing credential, an ambiguous requirement, or a policy question, do not guess.
    *   Stop immediately, change the ticket status to `status: BLOCKED`, log the specific blocker details in the Handoff Log, and alert the operator.
```
