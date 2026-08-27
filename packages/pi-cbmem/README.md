# 🧠 pi-cbmem — Codebase Memory Tools for Pi

[![npm: private](https://img.shields.io/badge/npm-private-lightgrey)](#-install) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

pi-cbmem is a private package that bundles the local Codebase Memory extension and its knowledge-graph operating skill.

## ✨ Features

- Registers all 15 Codebase Memory graph, search, indexing, coverage, trace, and architecture tools.
- Invokes the local `codebase-memory-mcp` CLI with cancellation, failure reporting, and bounded output.
- Bundles the `codebase-memory` skill for evidence-tier and graph-first workflows.
- Keeps the extension and skill available through one package declaration.

## 📦 Install

This package is private and is not published to npm.

Install it from this repository checkout:

```bash
pi install ./packages/pi-cbmem
```

Build and try it without adding a persistent package setting:

```bash
npm --workspace @narumitw/pi-cbmem run build
pi --no-extensions -e ./packages/pi-cbmem
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

Pi extensions run with your user permissions.

Review the source before loading the package.

## 🚀 Quick start

Install `codebase-memory-mcp` at `~/.local/bin/codebase-memory-mcp`, load the package, and ask Pi a structural codebase question.

The bundled skill tells Pi to check the active graph project before exploration and to verify material claims with graph snippets and index-coverage evidence.

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

Each tool sends JSON arguments to `codebase-memory-mcp cli <tool>` over standard input and returns the last JSON response written to standard output.

Validated JSON output over 2,000 lines is truncated with an explicit omission notice.

Standard output over 50 KB fails safely because the complete JSON response cannot be validated within the bounded capture.

Spawn failures, nonzero exits, oversized output, and missing JSON responses are reported as failed tool calls.

## 🔒 Security and privacy

The Codebase Memory binary runs with the Pi process environment and user permissions.

Tool calls can read and index repositories, inspect source, persist graph data, manage architecture decisions and traces, or delete indexed projects.

Deleting a project or replacing its Architecture Decision Records requires explicit confirmation in TUI or RPC mode and is rejected in non-interactive modes.

Repository content returned by graph tools can be sent to the selected model provider as tool output.

Terminal controls are removed only from the TUI rendering boundary; the validated raw result remains available to the model.

The extension starts one local CLI child process per tool call in the active session directory and does not start background work during extension factory load.

Cancelling a tool call terminates its child process.

## 🚧 Limitations

The package expects the binary at `~/.local/bin/codebase-memory-mcp` for the current user.

It does not install or update the Codebase Memory binary.

The extension exposes static tool schemas that match the bundled Codebase Memory skill and delegates final argument validation to the installed CLI.

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
│   └── tool-definitions.ts         # Pi tool metadata and TypeBox schemas
├── skills/codebase-memory/
│   └── SKILL.md                    # Graph-first operating guidance
├── test/
│   ├── build-runtime.test.ts       # Generated-runtime and Jiti loader coverage
│   └── cbmem.test.ts               # Tool registration coverage
├── package.json                    # Private Pi extension and skill declarations
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
