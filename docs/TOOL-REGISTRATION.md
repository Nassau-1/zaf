# Tool Registration

How to add a new tool (MCP server, plugin, capability description) to ZAF.

## What a tool is

A tool in ZAF is a named capability that an agent is permitted to invoke at runtime. The registry
is currently a description-only store: each entry has an `id`, display `name`, and a
`description` field that describes what the tool does and any operational bounds. The registry
does not own the implementation — implementations live wherever the host CLI (Claude Code, Codex,
etc.) finds them (MCP servers via that CLI's config, plugins, native tool-use). ZAF's registry is
the **operator-visible declaration of what each agent is allowed to touch**.

## How to register one

From the dashboard:

1. Open **Control Center → Agent Builder**.
2. In the right column, find **Register Tool**.
3. Enter:
   - **Tool ID** — alphanumeric only, used to reference the tool from agent configs (e.g.
     `DockerCompose`, `Postgres`, `Vexa`).
   - **Display Name** — what the operator sees in the Authorized Tools list.
   - **Capability description & bounds** — what the tool does, what an agent is allowed to do with
     it, and what it must not touch.
4. Click **Enroll Tool**.

The entry is appended to `config.json → toolsRegistry[]` via the existing `/api/config/save`
endpoint and persists across restarts.

## How to authorize a tool for an agent

1. **Agent Builder → Authorized Tools (in Advanced)** — check the tool for the current agent.
2. Save the agent. The tool id is stored in `agents[<key>].tools[]`.

## Current limitations

- **Seed-prompt injection — TKT-ZAF-0060.** As of 2026-05-29 the tools array is UI-only state.
  `composeSeedPrompt()` does NOT enumerate the tools at launch time. The agent will not know
  about its Authorized Tools until that ticket lands. Until then, treat the registry as
  documentation rather than enforcement.
- **No implementation binding.** Registering a tool here does not install an MCP server or
  plugin. Implementation install is the host CLI's responsibility.

## Storage

| What                | Where                                                | Lifecycle  |
| ---                 | ---                                                  | ---        |
| Tool definitions    | `dashboard/config.json → toolsRegistry[]`            | Persistent |
| Per-agent tool list | `dashboard/config.json → agents[<key>].tools[]`      | Persistent |

See [`PERSISTENCE.md`](./PERSISTENCE.md) for the full storage map.
