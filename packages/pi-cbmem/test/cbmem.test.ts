import assert from "node:assert/strict";
import { watch } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, test } from "vitest";
import cbmem, { callCodebaseMemory, TOOL_NAMES } from "../src/cbmem.js";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fixtureDirectory: string;
let fixtureBinary: string;

beforeAll(async () => {
	fixtureDirectory = await mkdtemp(path.join(tmpdir(), "pi-cbmem-test-"));
	fixtureBinary = path.join(fixtureDirectory, "codebase-memory-mcp.cjs");
	await writeFile(
		fixtureBinary,
		`#!/usr/bin/env node
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const args = JSON.parse(input || "{}");
  switch (args.testMode) {
    case "splitUtf8": {
      const output = Buffer.from(JSON.stringify({ cwd: process.cwd(), text: "你好🙂" }));
      const split = output.indexOf(Buffer.from("你")) + 1;
      process.stdout.write(output.subarray(0, split));
      setImmediate(() => process.stdout.end(output.subarray(split)));
      return;
    }
    case "large":
      process.stdout.write(JSON.stringify({ payload: "界".repeat(30000), tail: "must-not-appear" }));
      return;
    case "largeMalformed":
      process.stdout.write("not-json".repeat(10000));
      return;
    case "manyLines":
      process.stdout.write(JSON.stringify({ rows: Array.from({ length: 2500 }, (_, i) => i) }, null, 2));
      return;
    case "stderr":
      process.stderr.write("x".repeat(100000));
      process.stderr.write("\\nimportant failure");
      process.exitCode = 7;
      return;
    case "noJson":
      process.stdout.write("not a JSON response");
      return;
    case "wait": {
      const readyTempPath = args.readyPath + ".tmp";
      fs.writeFileSync(readyTempPath, String(process.pid));
      fs.renameSync(readyTempPath, args.readyPath);
      setInterval(() => {}, 1000);
      return;
    }
    default:
      process.stdout.write(JSON.stringify({ ok: true }));
  }
});
`,
		{ mode: 0o700 },
	);
	await chmod(fixtureBinary, 0o700);
});

afterAll(async () => {
	await rm(fixtureDirectory, { recursive: true, force: true });
});

test("cbmem registers complete Pi tool definitions", () => {
	const registered: ToolDefinition[] = [];
	const api = {
		registerTool(tool: ToolDefinition) {
			registered.push(tool);
		},
	} as unknown as ExtensionAPI;

	cbmem(api);

	assert.deepEqual(
		registered.map((tool) => tool.name),
		TOOL_NAMES,
	);
	for (const tool of registered) {
		assert.ok(tool.label);
		assert.match(tool.description, /output is limited/i);
		assert.equal((tool.parameters as { type?: unknown }).type, "object");
		assert.equal(typeof tool.execute, "function");
		assert.equal(typeof tool.renderResult, "function");
	}
});

test("destructive tools require observable confirmation before spawning", async () => {
	const tools = registerTools(fixtureBinary);
	const confirmations: Array<{ title: string; message: string }> = [];
	const acceptedContext = toolContext(async (title, message) => {
		confirmations.push({ title, message });
		return true;
	});
	const unsafeProject = "demo\u001b[31m-red\u001b[0m\u202e";

	await executeTool(tools, "delete_project", { project: unsafeProject }, acceptedContext);
	await executeTool(
		tools,
		"manage_adr",
		{ project: unsafeProject, mode: "update", content: "replacement" },
		acceptedContext,
	);
	await executeTool(tools, "manage_adr", { project: unsafeProject, mode: "get" }, acceptedContext);

	assert.equal(confirmations.length, 2);
	assert.match(confirmations[0]?.title ?? "", /Delete Codebase Memory project/);
	assert.match(confirmations[0]?.message ?? "", /Project: demo-red/);
	assert.match(confirmations[1]?.title ?? "", /Replace Codebase Memory ADRs/);
	assert.match(confirmations[1]?.message ?? "", /11 bytes/);
	for (const confirmation of confirmations) {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Verify terminal-control sanitization.
		assert.doesNotMatch(`${confirmation.title}\n${confirmation.message}`, /\u001b|\u202e/u);
	}

	const unavailableTools = registerTools(path.join(fixtureDirectory, "missing-binary"));
	const declinedContext = toolContext(async () => false);
	for (const [name, params] of [
		["delete_project", { project: "demo" }],
		["manage_adr", { project: "demo", mode: "update", content: "replacement" }],
	] as const) {
		await assert.rejects(
			executeTool(unavailableTools, name, params, declinedContext),
			(error: Error) => error.name === "AbortError",
		);
	}

	const nonUiContext = toolContext(async () => {
		throw new Error("confirmation must not be attempted without observable UI");
	}, "print");
	await assert.rejects(
		executeTool(unavailableTools, "delete_project", { project: "demo" }, nonUiContext),
		/requires user confirmation in TUI or RPC mode/,
	);

	const controller = new AbortController();
	const cancelledContext = toolContext(async (_title, _message, options) => {
		assert.equal(options?.signal, controller.signal);
		controller.abort();
		return true;
	});
	await assert.rejects(
		executeTool(
			unavailableTools,
			"delete_project",
			{ project: "demo" },
			cancelledContext,
			controller.signal,
		),
		(error: Error) => error.name === "AbortError",
	);
});

test("tool result rendering sanitizes display text without changing model-visible output", () => {
	const tool = registerTools(fixtureBinary).find(({ name }) => name === "search_graph");
	assert.ok(tool?.renderResult);
	const raw =
		"safe \u001b[31mred\u001b[0m \u001b]8;;https://example.invalid\u0007link\u001b]8;;\u0007 \u009b31mcyan\u009b0m \u202espoof";
	const result = {
		content: [{ type: "text" as const, text: raw }],
		details: { truncated: false, totalBytes: raw.length, totalLines: 1 },
	};
	const theme = { fg: (_color: string, text: string) => text };
	const rendered = tool.renderResult(
		result,
		{ expanded: true, isPartial: false },
		theme as never,
		{} as never,
	);
	const display = rendered.render(200).join("\n");

	assert.equal(result.content[0]?.text, raw);
	assert.match(display, /safe red link cyan spoof/);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Verify terminal-control sanitization.
	assert.doesNotMatch(display, /\u001b|\u009b|\u202e/u);
});

test("CLI calls use the session cwd and preserve split UTF-8 output", async () => {
	const cwd = await mkdtemp(path.join(fixtureDirectory, "cwd-"));
	const result = await callCodebaseMemory(
		"list_projects",
		{ testMode: "splitUtf8" },
		undefined,
		cwd,
		fixtureBinary,
	);

	assert.deepEqual(JSON.parse(resultText(result)), { cwd, text: "你好🙂" });
	assert.equal(result.details.truncated, false);
});

test("validated CLI output is bounded by Pi's line limit", async () => {
	const result = await callCodebaseMemory(
		"query_graph",
		{ testMode: "manyLines" },
		undefined,
		fixtureDirectory,
		fixtureBinary,
	);
	const text = resultText(result);
	assert.equal(result.details.truncated, true);
	assert.match(text, /additional output was omitted/);
	assert.ok(Buffer.byteLength(text, "utf8") <= DEFAULT_MAX_BYTES);
	assert.ok(countLines(text) <= DEFAULT_MAX_LINES);
});

test("byte-oversized stdout rejects before returning partial JSON", async () => {
	for (const testMode of ["large", "largeMalformed"]) {
		await assert.rejects(
			callCodebaseMemory("query_graph", { testMode }, undefined, fixtureDirectory, fixtureBinary),
			/exceeded 50(?:\.0)?KB before a complete JSON response could be validated/,
		);
	}
});

test("CLI spawn, exit, and response failures reject", async () => {
	await assert.rejects(
		callCodebaseMemory(
			"list_projects",
			{},
			undefined,
			fixtureDirectory,
			path.join(fixtureDirectory, "missing-binary"),
		),
		/ENOENT/,
	);

	await assert.rejects(
		callCodebaseMemory(
			"list_projects",
			{ testMode: "stderr" },
			undefined,
			fixtureDirectory,
			fixtureBinary,
		),
		(error: Error) => {
			assert.match(error.message, /exited with code 7/);
			assert.match(error.message, /important failure/);
			assert.match(error.message, /earlier stderr omitted/);
			assert.ok(Buffer.byteLength(error.message, "utf8") < 9 * 1024);
			return true;
		},
	);

	await assert.rejects(
		callCodebaseMemory(
			"list_projects",
			{ testMode: "noJson" },
			undefined,
			fixtureDirectory,
			fixtureBinary,
		),
		/no JSON response/,
	);
});

test("pre-aborted calls reject before spawning", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		callCodebaseMemory(
			"delete_project",
			{},
			controller.signal,
			fixtureDirectory,
			path.join(fixtureDirectory, "missing-binary"),
		),
		(error: Error) => error.name === "AbortError",
	);
});

test("aborting a running call terminates its child", async () => {
	const readyPath = path.join(fixtureDirectory, `ready-${Date.now()}`);
	const controller = new AbortController();
	const watcher = watch(fixtureDirectory);
	const ready = new Promise<void>((resolve) => {
		watcher.on("change", (_event, filename) => {
			if (filename === path.basename(readyPath)) resolve();
		});
	});
	const pending = callCodebaseMemory(
		"index_repository",
		{ testMode: "wait", readyPath },
		controller.signal,
		fixtureDirectory,
		fixtureBinary,
	);

	await ready;
	watcher.close();
	const pid = Number(await readFile(readyPath, "utf8"));
	assert.ok(Number.isSafeInteger(pid) && pid > 0, `expected a valid child PID, received ${pid}`);
	controller.abort();
	await assert.rejects(pending, (error: Error) => error.name === "AbortError");
	await waitForProcessExit(pid);
});

test("bundled skill enforces graph-first evidence and valid project-scoped calls", async () => {
	const skillDirectory = path.join(packageDirectory, "skills");
	const skill = await readFile(path.join(skillDirectory, "codebase-memory", "SKILL.md"), "utf8");
	const rootManifest = JSON.parse(
		await readFile(path.resolve(packageDirectory, "..", "..", "package.json"), "utf8"),
	) as { pi?: { skills?: string[] } };

	assert.ok(rootManifest.pi?.skills?.includes("./packages/pi-cbmem/skills"));

	for (const evidence of [
		/always prefer MCP graph tools/i,
		/## Priority Order/,
		/## When to Fall Back to Grep\/Glob/,
		/Scout \(Tier 1\)/,
		/Verify \(Tier 2, default\)/,
		/Auditor \(Tier 3\)/,
		/check_index_coverage` once with every evidence path/,
		/Do not assume subagents inherit MCP access/i,
	]) {
		assert.match(skill, evidence);
	}
	assert.doesNotMatch(skill, /delegate_task|Hermes/i);

	const documentedCalls = (tool: string) => [
		...skill.matchAll(new RegExp(`\\b${tool}\\(([^)]*)\\)`, "g")),
	];
	for (const tool of [
		"search_graph",
		"trace_path",
		"get_code_snippet",
		"get_graph_schema",
		"query_graph",
		"search_code",
		"check_index_coverage",
		"detect_changes",
	]) {
		const calls = documentedCalls(tool);
		assert.ok(calls.length > 0, `expected at least one documented ${tool} call`);
		assert.ok(
			calls.every((call) => call[1]?.includes('project="<name>"')),
			`expected every documented ${tool} call to include project`,
		);
	}
	assert.ok(
		documentedCalls("trace_path").every((call) => call[1]?.includes("function_name=")),
		"expected every documented trace_path call to include function_name",
	);
	assert.ok(
		documentedCalls("search_graph").every((call) => !call[1]?.includes("direction=")),
		"expected documented search_graph calls to omit its unsupported direction argument",
	);
});

function registerTools(binary: string): ToolDefinition[] {
	const tools: ToolDefinition[] = [];
	const api = {
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
	} as unknown as ExtensionAPI;
	cbmem(api, binary);
	return tools;
}

function toolContext(
	confirm: (title: string, message: string, options?: { signal?: AbortSignal }) => Promise<boolean>,
	mode: "tui" | "rpc" | "print" | "json" = "tui",
): ExtensionContext {
	return {
		cwd: fixtureDirectory,
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		ui: { confirm },
	} as unknown as ExtensionContext;
}

async function executeTool(
	tools: ToolDefinition[],
	name: string,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	signal?: AbortSignal,
) {
	const tool = tools.find((candidate) => candidate.name === name);
	assert.ok(tool, `expected registered tool ${name}`);
	return await tool.execute("test-call", params, signal, undefined, ctx);
}

function resultText(result: Awaited<ReturnType<typeof callCodebaseMemory>>): string {
	const content = result.content[0];
	assert.equal(content?.type, "text");
	return content.text;
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

async function waitForProcessExit(pid: number): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (processExists(pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal(processExists(pid), false, `expected process ${pid} to exit after cancellation`);
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}
