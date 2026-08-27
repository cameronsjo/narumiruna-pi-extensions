import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const BIN = join(homedir(), ".local", "bin", "codebase-memory-mcp");

export const TOOL_NAMES = [
	"index_repository",
	"search_graph",
	"query_graph",
	"trace_path",
	"get_code_snippet",
	"get_graph_schema",
	"get_architecture",
	"search_code",
	"list_projects",
	"delete_project",
	"index_status",
	"check_index_coverage",
	"detect_changes",
	"manage_adr",
	"ingest_traces",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];
type ToolArguments = Record<string, unknown> | undefined;
type ToolContext = { signal?: AbortSignal } | undefined;
type ToolDefinition = {
	name: ToolName;
	run: (args: ToolArguments, ctx: ToolContext) => Promise<unknown>;
};
type ExtensionAPI = {
	registerTool: (tool: ToolDefinition) => void;
};

async function call(tool: ToolName, args: ToolArguments, signal?: AbortSignal): Promise<unknown> {
	return new Promise((resolve) => {
		const child = spawn(BIN, ["cli", tool, JSON.stringify(args ?? {})], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, CBM_LOG_LEVEL: "error" },
		});
		let out = "";
		const onAbort = () => {
			if (!child.killed) child.kill();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (data) => {
			out += data.toString();
		});
		child.on("error", (error) => {
			signal?.removeEventListener("abort", onAbort);
			resolve({ error: error.message });
		});
		child.on("close", () => {
			signal?.removeEventListener("abort", onAbort);
			const lines = out
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			for (let index = lines.length - 1; index >= 0; index--) {
				try {
					return resolve(JSON.parse(lines[index]));
				} catch {
					// Keep scanning for the last JSON response.
				}
			}
			resolve({ error: "no JSON response from codebase-memory-mcp" });
		});
	});
}

export default function cbmem(pi: ExtensionAPI): void {
	for (const name of TOOL_NAMES) {
		pi.registerTool({
			name,
			run: (args, ctx) => call(name, args, ctx?.signal),
		});
	}
}
