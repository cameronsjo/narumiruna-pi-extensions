import { StringEnum } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Type } from "typebox";

export type BridgeToolDefinition = Pick<
	ToolDefinition<TSchema>,
	"name" | "label" | "description" | "parameters"
>;

const Project = Type.String({ description: "Indexed project name from list_projects." });
const outputLimit = `Output is limited to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; byte-oversized responses fail validation instead of returning partial JSON.`;

export const TOOL_DEFINITIONS = [
	{
		name: "index_repository",
		label: "Index Repository",
		description: `Index a repository in the Codebase Memory graph. ${outputLimit}`,
		parameters: Type.Object({
			repo_path: Type.String({ description: "Path to the repository." }),
			mode: Type.Optional(
				StringEnum(["full", "moderate", "fast", "cross-repo-intelligence"] as const),
			),
			target_projects: Type.Optional(Type.Array(Type.String())),
			name: Type.Optional(Type.String({ description: "Override the derived project name." })),
			persistence: Type.Optional(Type.Boolean()),
		}),
	},
	{
		name: "search_graph",
		label: "Search Graph",
		description: `Search indexed symbols by text, name, file, relationship, or degree. ${outputLimit}`,
		parameters: Type.Object({
			project: Project,
			query: Type.Optional(Type.String({ description: "Natural-language or keyword search." })),
			label: Type.Optional(Type.String()),
			name_pattern: Type.Optional(Type.String()),
			qn_pattern: Type.Optional(Type.String()),
			file_pattern: Type.Optional(Type.String()),
			relationship: Type.Optional(Type.String()),
			min_degree: Type.Optional(Type.Integer()),
			max_degree: Type.Optional(Type.Integer()),
			exclude_entry_points: Type.Optional(Type.Boolean()),
			include_connected: Type.Optional(Type.Boolean()),
			semantic_query: Type.Optional(Type.Array(Type.String())),
			limit: Type.Optional(Type.Integer()),
			offset: Type.Optional(Type.Integer()),
			format: Type.Optional(StringEnum(["tree", "json"] as const)),
			fields: Type.Optional(Type.Array(Type.String())),
			detail: Type.Optional(StringEnum(["ids", "default"] as const)),
		}),
	},
	{
		name: "query_graph",
		label: "Query Graph",
		description: `Execute a Cypher query against the code or missed-coverage graph. ${outputLimit}`,
		parameters: Type.Object({
			query: Type.String({ description: "Cypher query." }),
			project: Project,
			graph: Type.Optional(StringEnum(["code", "missed"] as const)),
			max_rows: Type.Optional(Type.Integer()),
		}),
	},
	{
		name: "trace_path",
		label: "Trace Path",
		description: `Trace callers, callees, data flow, or cross-service paths. ${outputLimit}`,
		parameters: Type.Object({
			function_name: Type.String(),
			project: Project,
			direction: Type.Optional(StringEnum(["inbound", "outbound", "both"] as const)),
			depth: Type.Optional(Type.Integer()),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
			cursor: Type.Optional(Type.String()),
			mode: Type.Optional(StringEnum(["calls", "data_flow", "cross_service"] as const)),
			parameter_name: Type.Optional(Type.String()),
			edge_types: Type.Optional(Type.Array(Type.String())),
			risk_labels: Type.Optional(Type.Boolean()),
			include_tests: Type.Optional(Type.Boolean()),
			format: Type.Optional(StringEnum(["tree", "json"] as const)),
			include_evidence: Type.Optional(Type.Boolean()),
		}),
	},
	{
		name: "get_code_snippet",
		label: "Get Code Snippet",
		description: `Read source for an indexed symbol by qualified name. ${outputLimit}`,
		parameters: Type.Object({
			qualified_name: Type.String(),
			project: Project,
			include_neighbors: Type.Optional(Type.Boolean()),
		}),
	},
	{
		name: "get_graph_schema",
		label: "Get Graph Schema",
		description: `Get graph node labels and edge types. ${outputLimit}`,
		parameters: Type.Object({ project: Project }),
	},
	{
		name: "get_architecture",
		label: "Get Architecture",
		description: `Summarize architecture, dependencies, boundaries, clusters, or hotspots. ${outputLimit}`,
		parameters: Type.Object({
			project: Project,
			path: Type.Optional(Type.String()),
			aspects: Type.Optional(
				Type.Array(
					StringEnum([
						"all",
						"overview",
						"structure",
						"dependencies",
						"routes",
						"languages",
						"packages",
						"entry_points",
						"hotspots",
						"boundaries",
						"layers",
						"file_tree",
						"clusters",
						"cycles",
					] as const),
				),
			),
		}),
	},
	{
		name: "search_code",
		label: "Search Code",
		description: `Search source text and enrich matches with graph context. ${outputLimit}`,
		parameters: Type.Object({
			pattern: Type.String(),
			project: Project,
			file_pattern: Type.Optional(Type.String()),
			path_filter: Type.Optional(Type.String()),
			mode: Type.Optional(StringEnum(["compact", "full", "files"] as const)),
			context: Type.Optional(Type.Integer()),
			regex: Type.Optional(Type.Boolean()),
			debug: Type.Optional(Type.Boolean()),
			limit: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
	},
	{
		name: "list_projects",
		label: "List Projects",
		description: `List indexed Codebase Memory projects. ${outputLimit}`,
		parameters: Type.Object({
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
			include_details: Type.Optional(Type.Boolean()),
			metadata_only: Type.Optional(Type.Boolean()),
		}),
	},
	{
		name: "delete_project",
		label: "Delete Project",
		description: `Delete a project from the Codebase Memory index. ${outputLimit}`,
		parameters: Type.Object({ project: Project }),
	},
	{
		name: "index_status",
		label: "Index Status",
		description: `Get project index health, Git context, and coverage gaps. ${outputLimit}`,
		parameters: Type.Object({
			project: Project,
			verbose: Type.Optional(Type.Boolean()),
		}),
	},
	{
		name: "check_index_coverage",
		label: "Check Index Coverage",
		description: `Check best-effort index coverage for exact paths or bounded scopes. ${outputLimit}`,
		parameters: Type.Object({
			project: Project,
			paths: Type.Optional(Type.Array(Type.String(), { maxItems: 128 })),
			scopes: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
			scope_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
			scope_offset: Type.Optional(Type.Integer({ minimum: 0 })),
		}),
	},
	{
		name: "detect_changes",
		label: "Detect Changes",
		description: `Map a Git diff to changed files and impacted graph symbols. ${outputLimit}`,
		parameters: Type.Object({
			project: Project,
			scope: Type.Optional(StringEnum(["files", "impact"] as const)),
			direction: Type.Optional(StringEnum(["inbound", "outbound", "both"] as const)),
			depth: Type.Optional(Type.Integer()),
			limit: Type.Optional(Type.Integer({ maximum: 5000 })),
			base_branch: Type.Optional(Type.String()),
			since: Type.Optional(Type.String()),
			format: Type.Optional(StringEnum(["tree", "json"] as const)),
		}),
	},
	{
		name: "manage_adr",
		label: "Manage ADR",
		description: `Read or replace Architecture Decision Records. ${outputLimit}`,
		parameters: Type.Object(
			{
				project: Project,
				mode: Type.Optional(StringEnum(["get", "update", "sections"] as const)),
				content: Type.Optional(Type.String()),
			},
			{ additionalProperties: false },
		),
	},
	{
		name: "ingest_traces",
		label: "Ingest Traces",
		description: `Ingest runtime caller-to-callee traces into the graph. ${outputLimit}`,
		parameters: Type.Object({
			traces: Type.Array(
				Type.Object(
					{
						caller: Type.Optional(Type.String()),
						callee: Type.Optional(Type.String()),
						count: Type.Optional(Type.Integer()),
					},
					{ additionalProperties: false },
				),
			),
			project: Project,
		}),
	},
] as const satisfies readonly BridgeToolDefinition[];

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];
export const TOOL_NAMES: readonly ToolName[] = TOOL_DEFINITIONS.map(({ name }) => name);
