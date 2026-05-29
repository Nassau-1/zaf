# ZAF Backups

How ZAF backs up persistent state and how to restore from a snapshot.

## What is backed up

Driven by the persistence audit in [`PERSISTENCE.md`](./PERSISTENCE.md). Each snapshot includes:

| Source                                  | Inside the snapshot                |
| ---                                     | ---                                |
| `dashboard/config.json`                 | `dashboard/config.json`            |
| `dashboard/audit-log.jsonl`             | `dashboard/audit-log.jsonl`        |
| `dashboard/runs/`                       | `dashboard/runs/`                  |
| `<repo>/WIP/tickets/ACTIVE/`            | `repos/<slug>/WIP/tickets/ACTIVE/`   |
| `<repo>/WIP/tickets/ARCHIVED/`          | `repos/<slug>/WIP/tickets/ARCHIVED/` |
| `<repo>/WIP/tickets/TICKETS.md`         | `repos/<slug>/WIP/tickets/TICKETS.md`|
| `<repo>/WIP/programmes/`                | `repos/<slug>/WIP/programmes/`     |
| (a `manifest.json` summarising the snapshot)                                       ||

Out of scope: in-memory state (PTY processes Map, SSE clients, heartbeat retry counters) —
documented as ephemeral by design in PERSISTENCE.md.

## Storage location

Default: `C:/Users/LENOVO/Workspace/02_Runtime/zaf-backups/` per the workspace runtime rule
(`02_Runtime/` is where mutable runtime state belongs). Override with `ZAF_BACKUP_ROOT` env var
on the server process.

Layout:

```
02_Runtime/zaf-backups/
├── daily/
│   ├── 20260524-030000/   ← Grandfather rotation tier
│   ├── 20260525-030000/
│   └── …                  ← keep latest 7
├── weekly/
│   ├── 20260518-030000/   ← Mondays only
│   └── …                  ← keep latest 5
└── monthly/
    ├── 20260501-030000/   ← 1st of month only
    └── …                  ← keep latest 12
```

## Rotation policy (Grandfather–Father–Son)

| Tier    | Cadence                  | Retain    |
| ---     | ---                      | ---       |
| Daily   | Every day                | 7 newest  |
| Weekly  | Every Monday             | 5 newest  |
| Monthly | The 1st of every month   | 12 newest |

A single calendar day can satisfy multiple tiers (e.g. Monday the 1st of a month produces a
daily + weekly + monthly snapshot in the same run). Each tier's purge runs after every backup
attempt, so retention stays in policy even if the server was offline for several days.

## When backups run

- **Scheduled.** The server runs `backupTick()` every hour. The first hour after boot also runs
  one ~30s after startup so a fresh deploy gets a snapshot. `backupTick()` is idempotent within
  the same calendar day — re-running it the same day will not duplicate the daily snapshot.
- **Manual.** In the dashboard, **CLI Hub → Backup & Restore → Backup now**. Hits
  `POST /api/backup/run`.
- **Command line.** `node dashboard/backup.js` runs a backup using the same engine.

## Restore

The dashboard ships only **Restore latest** — it copies the most recent daily snapshot back into
the live tree:

- Dashboard files (`config.json`, `audit-log.jsonl`) are overwritten in place.
- Each `repos/<slug>/WIP/` in the snapshot is restored into `<REPOS_ROOT>/<slug>/WIP/` ONLY if
  that slug already exists as a local repo. Repos missing locally are reported as skipped — the
  restore never silently creates a new repo directory.
- `dashboard/runs/` is intentionally NOT restored by the latest-restore path. Run captures are
  append-only artefacts; restoring them would resurrect stale process meta. To recover a specific
  run, copy it from the snapshot manually.

Command line: `node dashboard/backup.js restore` is equivalent to the dashboard button.

For point-in-time restores other than the latest daily, the operator manually selects the
snapshot folder in `02_Runtime/zaf-backups/<tier>/<stamp>/` and copies its contents back.

## Excluding backups from repo commits

`02_Runtime/` is outside any repo working tree, so backups are not tracked by git. The
`.gitignore` in each repo already excludes the in-repo runtime surfaces (`dashboard/runs/`,
`dashboard/audit-log.jsonl`).

## Operational notes

- The backup script is fail-soft: per-tier errors are recorded in the manifest's `errors[]` but
  do not abort the run. A weekly-tier failure does not block the daily-tier write.
- Backups are full snapshots, not incremental. Storage cost scales linearly with retention; for
  the listed tiers this is < ~100 MB total at typical state sizes today.
- Restoring overwrites `dashboard/config.json` and the audit log unconditionally — the dashboard
  asks the operator to confirm before doing so.
