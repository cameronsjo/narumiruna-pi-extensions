# 🧠 pi-cbmem — Deprecated Codebase Memory Tools for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-cbmem)](https://www.npmjs.com/package/@narumitw/pi-cbmem) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> `@narumitw/pi-cbmem` is deprecated without a replacement, kept under `deprecated/` for reference, and excluded from active workspace checks, tests, releases, and maintenance.
> A simple benchmark found that the extension did not improve results enough to justify its overhead, while token usage increased substantially.
> Remove the deprecated package with:
>
> ```bash
> pi uninstall npm:@narumitw/pi-cbmem
> ```

This archived extension connected Pi to the local Codebase Memory daemon through a persistent MCP stdio session and gave the model graph-first operating guidance.

## ✨ Features

- Registers 15 Codebase Memory tools for graph queries, search, indexing, coverage, tracing, and architecture.
- Detects the local Codebase Memory daemon when a Pi session starts and starts a permanent daemon when needed.
- Opens one verified daemon-backed MCP stdio session per Pi session with request cancellation, failure reporting, and bounded output.
- Bundles the `codebase-memory` skill for graph-first, evidence-tier workflows.
- Resolves `@current` to an exact current-root index or a matching clean canonical-checkout graph for approved read tools.
- Loads the extension and skill from one package.

## 📦 Archived reference

Build and inspect the archived package only when maintaining historical behavior:

```bash
cd deprecated/pi-cbmem
npm run build
pi -e .
```

The package declares `dist/index.ts`, so the build command must finish before Pi loads the archived package directory.

Pi extensions run with your user permissions.
Only load archived code from sources you trust.

## 🚀 Quick start

Install a current `codebase-memory-mcp` with the `daemon status` and `daemon start` commands at `~/.local/bin/codebase-memory-mcp`, then load pi-cbmem.
At session startup, pi-cbmem keeps an existing daemon or starts a permanent daemon that survives Pi session shutdown.
Then ask Pi a structural codebase question.
The bundled skill directs Pi to identify the active graph project before exploration and verify material claims with snippets and index-coverage evidence.

## 🌳 Worktree base reuse

Approved read tools accept `project="@current"`.
An index whose stored root is the current worktree wins.
When the linked worktree has no index, pi-cbmem can borrow the canonical checkout project only when both trees are clean, share one Git common directory and `HEAD`, and the graph-recorded Branch metadata matches that snapshot.
The extension validates the borrowed state before and after every call and identifies the borrowed project in `pi_cbmem_resolution`.
Borrowing is read-only and never copies, remaps, updates, or deletes an index.
Borrowed `get_code_snippet` results read the selected lines from the current worktree and report its path.

The `@current` alias is available for `search_graph`, `query_graph`, `trace_path`, `get_code_snippet`, `get_graph_schema`, `get_architecture`, and `index_status`.
It is intentionally unavailable for `search_code`, `check_index_coverage`, `detect_changes`, `manage_adr`, `ingest_traces`, `delete_project`, and `index_repository` because those operations read project-root state or mutate persisted data.
Use an explicit indexed project for those tools.
If the worktree is dirty, at another commit, ambiguous, or backed by a stale Branch snapshot, create its own index or use normal file tools.
Codebase Memory does not expose an immutable generation lease or complete semantic-input comparison, so this fallback is a conservative best-effort read optimization rather than worktree overlay indexing.

## 🛠️ Tools

The extension registers these tools:

- `index_repository`
- `search_graph`
- `query_graph`
- `trace_path`
- `get_code_snippet`
- `get_graph_schema`
- `get_architecture`
- `search_code`
- `list_projects`
- `delete_project`
- `index_status`
- `check_index_coverage`
- `detect_changes`
- `manage_adr`
- `ingest_traces`

Each tool sends its arguments through MCP `tools/call` on the Pi session's persistent `codebase-memory-mcp` stdio child.
The extension verifies at startup that the child PID is a committed client of the active account daemon before exposing a ready session.
Validated JSON longer than 2,000 lines is truncated with an omission notice.
MCP text content over 50 KB fails before partial structured output can be returned.
MCP protocol failures, tool errors, oversized output, unsupported content, and invalid JSON fail the tool call.

## 🔒 Security and privacy

The Codebase Memory binary inherits the Pi process environment and user permissions.
Tool calls can read and index repositories, inspect source, persist graph data, manage architecture decisions and traces, or delete indexed projects.
Deleting a project or replacing all Architecture Decision Records requires explicit confirmation in TUI or RPC mode and is rejected in other modes.
Repository content returned by graph tools can be sent to the selected model provider as tool output.
Terminal controls are removed at the TUI display boundary, while the validated raw result remains available to the model.
Extension factory loading starts no background work.
Session startup runs bounded `daemon status` and, when needed, `daemon start` control processes in the active session directory.
It then starts one MCP stdio child in that directory, completes the MCP initialize handshake, and verifies the child under the daemon's committed client list.
The permanent account-scoped daemon survives Pi session replacement and shutdown until the user runs `codebase-memory-mcp daemon stop`.
Session replacement and shutdown cancel startup, close the session's MCP child, and await cleanup without stopping the permanent daemon.
Cancelling one tool call sends MCP request cancellation without terminating the session or unrelated calls.
A closed or failed MCP session does not fall back to one-shot CLI execution because that would make transport behavior ambiguous.
Run `/reload` to create a new verified MCP session after a binary, daemon, or stdio failure.

## 🚧 Limitations

- The package requires a current `~/.local/bin/codebase-memory-mcp` with daemon control commands, no-argument MCP stdio mode, and committed-client PID reporting for the current user.
- It does not install or update the Codebase Memory binary, and it does not stop the permanent daemon.
- It does not reconnect automatically inside a failed Pi session; use `/reload` after correcting the underlying problem.
- Static tool schemas match the bundled skill, while the installed CLI performs final argument validation.
- Worktree base reuse requires an exact clean snapshot and does not cover branch changes, dirty files, source-code search, change detection, index mutation, project forking, or overlays.

## 🗂️ Package layout

```text
deprecated/pi-cbmem/
├── dist/                           # Generated source-mapped Jiti runtime
├── scripts/
│   └── build-runtime.mjs           # Deterministic runtime builder and validator
├── src/
│   ├── index.ts                    # Thin Pi entrypoint
│   ├── cbmem.ts                    # Bounded Pi-to-MCP tool adapter
│   ├── daemon.ts                   # Daemon control and session lifecycle
│   ├── mcp-session.ts              # Persistent verified MCP stdio client
│   ├── render-result.ts            # Terminal-safe result rendering
│   ├── tool-definitions.ts         # Pi tool metadata and TypeBox schemas
│   └── worktree-project.ts         # Safe current-worktree project resolution
├── skills/codebase-memory/
│   └── SKILL.md                    # Graph-first operating guidance
├── test/
│   ├── build-runtime.test.ts       # Generated-runtime and Jiti loader coverage
│   ├── cbmem.test.ts               # Tool and lifecycle coverage
│   ├── mcp-session.test.ts         # MCP protocol and process coverage
│   └── worktree-project.test.ts    # Worktree resolution coverage
├── package.json                    # Pi extension and skill declarations
├── tsconfig.json
├── README.md
└── LICENSE
```

The generated runtime is built from the authoritative `src/index.ts` graph and does not import back into `src`.

## 🔎 Keywords

Pi, Codebase Memory, code knowledge graph, MCP, call graph, architecture, impact analysis, source indexing.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
