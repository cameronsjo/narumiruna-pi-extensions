---
name: codebase-memory
description: "Use the codebase knowledge graph for structural code queries. Triggers on: explore the codebase, understand the architecture, what functions exist, show me the structure, who calls this function, what does X call, trace the call chain, find callers of, show dependencies, impact analysis, dead code, unused functions, high fan-out, refactor candidates, code quality audit, graph query syntax, Cypher query examples, edge types, how to use search_graph."
---

# Codebase Memory — Knowledge Graph Tools

Graph tools return precise structural results in ~500 tokens vs ~80K for grep.

Always prefer MCP graph tools over grep, glob, or file search for code discovery.

## Priority Order

1. `search_graph` — find functions, classes, routes, and variables by pattern.
2. `trace_path` — trace who calls a function or what it calls.
3. `get_code_snippet` — read specific function or class source code.
4. `check_index_coverage` — validate candidate paths and missed ranges before claims.
5. `query_graph` — run Cypher queries for complex patterns.
6. `get_architecture` — get a high-level project summary.

## Quick Decision Matrix

Use the exact `project="<name>"` returned by `list_projects` in every project-scoped call.

| Question | Tool call |
|----------|----------|
| Who calls X? | `trace_path(project="<name>", direction="inbound")` |
| What does X call? | `trace_path(project="<name>", direction="outbound")` |
| Full call context | `trace_path(project="<name>", direction="both")` |
| Find by name pattern | `search_graph(project="<name>", name_pattern="...")` |
| Dead code | `search_graph(project="<name>", max_degree=0, exclude_entry_points=true)` |
| Cross-service edges | `query_graph(project="<name>", query="<cypher>")` |
| Impact of local changes | `detect_changes(project="<name>")` |
| Risk-classified trace | `trace_path(project="<name>", risk_labels=true)` |
| Text search | `search_code(project="<name>", pattern="...")` or Grep |

## Exploration Workflow

1. `list_projects` — check whether the project is indexed and copy its exact name.
2. `get_graph_schema(project="<name>")` — understand node and edge types.
3. `search_graph(project="<name>", label="Function", name_pattern=".*Pattern.*")` — find code.
4. `get_code_snippet(project="<name>", qualified_name="project.path.FuncName")` — read source.
5. `check_index_coverage(project="<name>", paths=["path/to/file"])` — validate every evidence path.

## Tracing Workflow

1. `search_graph(project="<name>", name_pattern=".*FuncName.*")` — discover the exact name.
2. `trace_path(project="<name>", function_name="FuncName", direction="both", depth=3)` — trace relationships.
3. `get_code_snippet(project="<name>", qualified_name="project.path.FuncName")` — verify material source claims.
4. `check_index_coverage(project="<name>", paths=["path/to/file"])` — validate every evidence path.
5. `detect_changes(project="<name>")` — map the Git diff to affected symbols.

## When to Fall Back to Grep/Glob

- Search for string literals, error messages, or configuration values.
- Search non-code files such as Dockerfiles, shell scripts, or configuration files.
- Fall back when MCP tools return insufficient results.

## Examples

- Find a handler: `search_graph(project="<name>", name_pattern=".*OrderHandler.*")`.
- Find who calls it: `trace_path(project="<name>", function_name="OrderHandler", direction="inbound")`.
- Read its source: `get_code_snippet(project="<name>", qualified_name="pkg/orders.OrderHandler")`.

## Evidence Tiers

- **Scout (Tier 1):** quick positive lookup with few calls and targeted source checks.
  Mark it provisional, and do not make negative or exhaustive claims.
- **Verify (Tier 2, default):** task-directed graph evidence, relevant trace directions, exact snippets for material claims, and relevant pagination.
- **Auditor (Tier 3):** bounded-scope full verification with a current generation, complete relevant pagination, both call directions and broader relationships when material, and every limitation disclosed.
- After candidate paths are known in any tier, call `check_index_coverage` once with every evidence path.
  Add relevant scopes for negative or exhaustive claims.
  A clean result means no recorded gap, not proof of completeness.
  For partial, skipped, excluded, stale, pending, or unknown coverage, read or grep the reported ranges or scope before relying on graph results.

## Session Resets and Subagents

- At session start or after compaction, confirm the nearest graph project and generation with `list_projects` or `index_status`, then choose Scout, Verify, or Auditor.
- Before spawning a subagent, query the graph and coverage in the parent.
  Pass the tier, project, generation or freshness, bounded scope, queries and pagination state, qualified symbols, paths, call-chain findings, coverage evidence with ranges and reasons, source fallback already performed, and unresolved questions in the delegated task context.
- Do not assume subagents inherit MCP access or the parent conversation.
  If a child lacks MCP tools, it must not call or claim MCP access.
  It should use the supplied evidence and read or grep exact source, especially every reported missed-coverage range.

## Quality Analysis
- Dead code: `search_graph(project="<name>", max_degree=0, exclude_entry_points=true)`
- High fan-out: `search_graph(project="<name>", min_degree=10, relationship="CALLS", direction="outbound")`
- High fan-in: `search_graph(project="<name>", min_degree=10, relationship="CALLS", direction="inbound")`

## 15 MCP Tools
`index_repository`, `index_status`, `list_projects`, `delete_project`,
`search_graph`, `search_code`, `trace_path`, `detect_changes`,
`query_graph`, `get_graph_schema`, `get_code_snippet`, `get_architecture`,
`check_index_coverage`, `manage_adr`, `ingest_traces`

## Edge Types
CALLS, HTTP_CALLS, ASYNC_CALLS, DATA_FLOWS, IMPORTS, DEFINES, DEFINES_METHOD,
HANDLES, IMPLEMENTS, OVERRIDE, USAGE, CALL_REFERENCE, CONFIGURES, FILE_CHANGES_WITH,
SIMILAR_TO, SEMANTICALLY_RELATED, CONTAINS_FILE, CONTAINS_FOLDER,
CONTAINS_PACKAGE

## Cypher Examples (for query_graph)
```
MATCH (a)-[r:HTTP_CALLS]->(b) RETURN a.name, b.name, r.url_path, r.confidence LIMIT 20
MATCH (f:Function) WHERE f.name =~ '.*Handler.*' RETURN f.name, f.file_path
MATCH (a)-[r:CALLS]->(b) WHERE a.name = 'main' RETURN b.name
```

## Gotchas
1. `search_graph(project="<name>", relationship="HTTP_CALLS")` filters nodes by degree — use `query_graph` with Cypher to see actual edges.
2. `query_graph` has a 100k row ceiling — add a Cypher `LIMIT` for broad queries or use `search_graph` pagination.
3. `trace_path` needs exact names — use `search_graph(project="<name>", name_pattern=...)` first.
4. `direction="outbound"` misses cross-service callers — use `direction="both"`.
5. `search_graph` results default to 50 per page — check `has_more` and use `offset`.
