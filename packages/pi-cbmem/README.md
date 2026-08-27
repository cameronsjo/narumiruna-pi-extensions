# 🧠 pi-cbmem — Codebase Memory Tools for Pi

[![npm: private](https://img.shields.io/badge/npm-private-lightgrey)](#-install) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

pi-cbmem is a private package that bundles the local Codebase Memory extension and its knowledge-graph operating skill.

## ✨ Features

- Registers all 15 Codebase Memory graph, search, indexing, coverage, trace, and architecture tools.
- Invokes the local `codebase-memory-mcp` CLI with cancellation support.
- Bundles the `codebase-memory` skill for evidence-tier and graph-first workflows.
- Keeps the extension and skill available through one package declaration.

## 📦 Install

This package is private and is not published to npm.

Install it from this repository checkout:

```bash
pi install ./packages/pi-cbmem
```

Try it without adding a persistent package setting:

```bash
pi --no-extensions -e ./packages/pi-cbmem
```

The package uses its source entrypoint and does not require a build before local loading.

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

Each tool delegates to `codebase-memory-mcp cli <tool> <json-args>` and returns the last JSON line written to standard output.

## 🔒 Security and privacy

The Codebase Memory binary runs with the Pi process environment and user permissions.

Tool calls can read and index repositories, inspect source, persist graph data, manage architecture decisions and traces, or delete indexed projects.

Repository content returned by graph tools can be sent to the selected model provider as tool output.

The extension starts one local CLI child process per tool call and does not start background work during extension factory load.

## 🚧 Limitations

The package expects the binary at `~/.local/bin/codebase-memory-mcp` for the current user.

It does not install or update the Codebase Memory binary.

The extension preserves the installer-generated `name` and `run` tool bridge expected by the current Pi environment.

## 🗂️ Package layout

```text
packages/pi-cbmem/
├── src/
│   ├── index.ts                    # Thin Pi entrypoint
│   └── cbmem.ts                    # Codebase Memory CLI tool bridge
├── skills/codebase-memory/
│   └── SKILL.md                    # Graph-first operating guidance
├── test/
│   └── cbmem.test.ts               # Tool registration coverage
├── package.json                    # Private Pi extension and skill declarations
├── tsconfig.json
├── README.md
└── LICENSE
```

## 🔎 Keywords

Pi, Codebase Memory, code knowledge graph, MCP, call graph, architecture, impact analysis, source indexing.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
