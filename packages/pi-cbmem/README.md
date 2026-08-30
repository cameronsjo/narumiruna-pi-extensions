# 🧠 pi-cbmem — Codebase Memory Tools for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-cbmem)](https://www.npmjs.com/package/@narumitw/pi-cbmem) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Connect Pi to the local Codebase Memory CLI and give the model graph-first operating guidance.

## ✨ Features

- Registers 15 Codebase Memory tools for graph queries, search, indexing, coverage, tracing, and architecture.
- Runs the local `codebase-memory-mcp` CLI with cancellation, failure reporting, and bounded output.
- Bundles the `codebase-memory` skill for graph-first, evidence-tier workflows.
- Resolves `@current` to an exact current-root index or a matching clean canonical-checkout graph for approved read tools.
- Loads the extension and skill from one package.

## 📦 Install

Install persistently from npm:

```bash
pi install npm:@narumitw/pi-cbmem
```

Try from npm without installing permanently:

```bash
pi -e npm:@narumitw/pi-cbmem
```

Build and load a local checkout from the repository root:

```bash
npm --workspace @narumitw/pi-cbmem run build
pi --no-extensions -e ./packages/pi-cbmem
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

Pi extensions run with your user permissions.
Install only trusted packages, and review the source before loading this extension.

## 🚀 Quick start

Install `codebase-memory-mcp` at `~/.local/bin/codebase-memory-mcp`, load pi-cbmem, and ask Pi a structural codebase question.
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

Each tool sends JSON arguments to `codebase-memory-mcp cli <tool>` over standard input and returns the final JSON response from standard output.
Validated JSON longer than 2,000 lines is truncated with an omission notice.
Standard output over 50 KB fails because the extension cannot validate a complete JSON response within its capture limit.
Spawn failures, nonzero exits, oversized output, and missing JSON responses fail the tool call.

## 🔒 Security and privacy

The Codebase Memory binary inherits the Pi process environment and user permissions.
Tool calls can read and index repositories, inspect source, persist graph data, manage architecture decisions and traces, or delete indexed projects.
Deleting a project or replacing all Architecture Decision Records requires explicit confirmation in TUI or RPC mode and is rejected in other modes.
Repository content returned by graph tools can be sent to the selected model provider as tool output.
Terminal controls are removed at the TUI display boundary, while the validated raw result remains available to the model.
Each tool call starts one local CLI child process in the active session directory; extension loading starts no background work.
Cancelling the tool call terminates that child process.

## 🚧 Limitations

- The package requires `~/.local/bin/codebase-memory-mcp` for the current user.
- It does not install or update the Codebase Memory binary.
- Static tool schemas match the bundled skill, while the installed CLI performs final argument validation.
- Worktree base reuse requires an exact clean snapshot and does not cover branch changes, dirty files, source-code search, change detection, index mutation, project forking, or overlays.

## 🗂️ Package layout

```text
packages/pi-cbmem/
├── dist/                           # Generated source-mapped Jiti runtime
├── scripts/
│   └── build-runtime.mjs           # Deterministic runtime builder and validator
├── src/
│   ├── index.ts                    # Thin Pi entrypoint
│   ├── cbmem.ts                    # Bounded Codebase Memory CLI runner
│   ├── render-result.ts            # Terminal-safe result rendering
│   ├── tool-definitions.ts         # Pi tool metadata and TypeBox schemas
│   └── worktree-project.ts         # Safe current-worktree project resolution
├── skills/codebase-memory/
│   └── SKILL.md                    # Graph-first operating guidance
├── test/
│   ├── build-runtime.test.ts       # Generated-runtime and Jiti loader coverage
│   └── cbmem.test.ts               # Tool registration coverage
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
