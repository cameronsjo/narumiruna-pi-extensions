// This integration suite intentionally shares one serial daemon fixture and lifecycle harness so
// process environment mutations, cancellation handshakes, and child cleanup cannot race across files.
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
import cbmem, {
	type CbmemToolDetails,
	callCodebaseMemory,
	readLineRange,
	TOOL_NAMES,
} from "../src/cbmem.js";
import {
	type DaemonEnsurer,
	ensureCodebaseMemoryDaemon,
	verifyCodebaseMemoryDaemonClient,
} from "../src/daemon.js";
import type { CodebaseMemorySession, CodebaseMemorySessionFactory } from "../src/mcp-session.js";
import type { ProjectResolution, ProjectResolutionService } from "../src/worktree-project.js";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolSessionManager = {};
let fixtureDirectory: string;
let fixtureBinary: string;

type LifecycleHandler = (event: never, ctx: ExtensionContext) => Promise<void> | void;

beforeAll(async () => {
	fixtureDirectory = await mkdtemp(path.join(tmpdir(), "pi-cbmem-test-"));
	fixtureBinary = path.join(fixtureDirectory, "codebase-memory-mcp.cjs");
	await writeFile(
		fixtureBinary,
		`#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] === "daemon") {
  const command = process.argv[3];
  const statePath = process.env.CBMEM_TEST_DAEMON_STATE;
  const logPath = process.env.CBMEM_TEST_DAEMON_LOG;
  if (logPath) fs.appendFileSync(logPath, command + "\\n");
  if (command === "status") {
    const waitReadyPath = process.env.CBMEM_TEST_DAEMON_WAIT_READY;
    if (waitReadyPath) {
      fs.writeFileSync(waitReadyPath + ".tmp", String(process.pid));
      fs.renameSync(waitReadyPath + ".tmp", waitReadyPath);
      setInterval(() => {}, 1000);
    } else if (statePath && fs.existsSync(statePath)) {
      const clients = (process.env.CBMEM_TEST_COMMITTED_PIDS || "").split(",").filter(Boolean);
      process.stdout.write("daemon: active (permanent)\\n");
      process.stdout.write("  committed clients: " + clients.length + "\\n");
      for (const pid of clients) process.stdout.write("    - pid " + pid + "\\n");
    } else {
      process.stdout.write("daemon: not running\\n");
      process.exitCode = 1;
    }
  } else if (command === "start") {
    if (process.env.CBMEM_TEST_DAEMON_START_FAIL === "1") {
      process.stderr.write("daemon startup failed\\n");
      process.exitCode = 9;
    } else {
      if (statePath) fs.writeFileSync(statePath, String(process.pid));
      process.stdout.write("daemon: started (permanent)\\n");
    }
  }
} else {
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
    case "nearLimit":
      process.stdout.write(JSON.stringify({ payload: "x".repeat(51000) }));
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
    case "snippet":
      process.stdout.write(JSON.stringify({
        name: "answer",
        qualified_name: "source-project.example.answer",
        label: "Variable",
        file_path: args.sourcePath,
        start_line: 2,
        end_line: 2,
        source: "source copy\\n",
      }));
      return;
    default:
      process.stdout.write(JSON.stringify({ ok: true, args, tool: process.argv[3] }));
  }
});
}
`,
		{ mode: 0o700 },
	);
	await chmod(fixtureBinary, 0o700);
});

afterAll(async () => {
	await rm(fixtureDirectory, { recursive: true, force: true });
});

test("cbmem registers complete Pi tool definitions and daemon lifecycle", () => {
	const registered: ToolDefinition[] = [];
	const events: string[] = [];
	const api = {
		on(event: string) {
			events.push(event);
		},
		registerTool(tool: ToolDefinition) {
			registered.push(tool);
		},
	} as unknown as ExtensionAPI;

	cbmem(api);

	assert.deepEqual(events, ["session_start", "session_shutdown"]);

	assert.deepEqual(
		registered.map((tool) => tool.name),
		TOOL_NAMES,
	);
	const aliasTools = new Set([
		"get_architecture",
		"get_code_snippet",
		"get_graph_schema",
		"index_status",
		"query_graph",
		"search_graph",
		"trace_path",
	]);
	for (const tool of registered) {
		assert.ok(tool.label);
		assert.match(tool.description, /output is limited/i);
		assert.equal((tool.parameters as { type?: unknown }).type, "object");
		assert.equal(typeof tool.execute, "function");
		assert.equal(typeof tool.renderResult, "function");
		const projectDescription = (
			tool.parameters as { properties?: { project?: { description?: string } } }
		).properties?.project?.description;
		if (aliasTools.has(tool.name)) assert.match(projectDescription ?? "", /@current/u);
		else assert.doesNotMatch(projectDescription ?? "", /@current/u);
	}
});

test("tools reuse sessions by session manager and isolate concurrent managers", async () => {
	const handlers = new Map<string, LifecycleHandler[]>();
	const tools: ToolDefinition[] = [];
	let nextPid = 200;
	const api = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
	} as unknown as ExtensionAPI;
	cbmem(
		api,
		fixtureBinary,
		undefined,
		async () => ({ started: false }),
		async (_binary, cwd) => mockSession(cwd, () => {}, ++nextPid),
		async () => {},
	);
	const first = lifecycleContext("print", {});
	const second = lifecycleContext("print", {});
	for (const handler of handlers.get("session_start") ?? []) {
		await Promise.all([handler({} as never, first.ctx), handler({} as never, second.ctx)]);
	}
	const firstCall = await executeTool(tools, "list_projects", {}, first.ctx);
	const repeated = await executeTool(tools, "list_projects", {}, first.ctx);
	const isolated = await executeTool(tools, "list_projects", {}, second.ctx);
	const firstPid = (firstCall.details as CbmemToolDetails).bridge.serverPid;
	assert.equal((repeated.details as CbmemToolDetails).bridge.serverPid, firstPid);
	assert.notEqual((isolated.details as CbmemToolDetails).bridge.serverPid, firstPid);
	for (const handler of handlers.get("session_shutdown") ?? []) {
		await Promise.all([handler({} as never, first.ctx), handler({} as never, second.ctx)]);
	}
});

test("daemon controller starts only when status reports no active daemon", async () => {
	const statePath = path.join(fixtureDirectory, `daemon-state-${Date.now()}`);
	const logPath = path.join(fixtureDirectory, `daemon-log-${Date.now()}`);
	await withDaemonFixture(statePath, logPath, async () => {
		const controller = new AbortController();
		assert.deepEqual(
			await ensureCodebaseMemoryDaemon(fixtureBinary, fixtureDirectory, controller.signal),
			{ started: true },
		);
		assert.deepEqual(
			await ensureCodebaseMemoryDaemon(fixtureBinary, fixtureDirectory, controller.signal),
			{ started: false },
		);
	});

	assert.deepEqual((await readFile(logPath, "utf8")).trim().split("\n"), [
		"status",
		"start",
		"status",
	]);
});

test("daemon controller cancellation terminates its status process", async () => {
	const statePath = path.join(fixtureDirectory, `daemon-cancel-state-${Date.now()}`);
	const logPath = path.join(fixtureDirectory, `daemon-cancel-log-${Date.now()}`);
	const readyPath = path.join(fixtureDirectory, `daemon-cancel-ready-${Date.now()}`);
	await withDaemonFixture(statePath, logPath, async () => {
		process.env.CBMEM_TEST_DAEMON_WAIT_READY = readyPath;
		const watcher = watch(fixtureDirectory);
		const ready = new Promise<void>((resolve) => {
			watcher.on("change", (_event, filename) => {
				if (filename === path.basename(readyPath)) resolve();
			});
		});
		const controller = new AbortController();
		const pending = ensureCodebaseMemoryDaemon(fixtureBinary, fixtureDirectory, controller.signal);

		await ready;
		watcher.close();
		const pid = Number(await readFile(readyPath, "utf8"));
		controller.abort();
		await assert.rejects(pending, (error: Error) => error.name === "AbortError");
		await waitForProcessExit(pid);
	});
});

test("daemon controller reports bounded start failures", async () => {
	const statePath = path.join(fixtureDirectory, `daemon-failure-state-${Date.now()}`);
	const logPath = path.join(fixtureDirectory, `daemon-failure-log-${Date.now()}`);
	await withDaemonFixture(statePath, logPath, async () => {
		process.env.CBMEM_TEST_DAEMON_START_FAIL = "1";
		await assert.rejects(
			ensureCodebaseMemoryDaemon(fixtureBinary, fixtureDirectory, new AbortController().signal),
			/daemon start exited with code 9: daemon startup failed/u,
		);
	});
});

test("daemon client verification requires the MCP child PID", async () => {
	const statePath = path.join(fixtureDirectory, `daemon-client-state-${Date.now()}`);
	const logPath = path.join(fixtureDirectory, `daemon-client-log-${Date.now()}`);
	await withDaemonFixture(statePath, logPath, async () => {
		await writeFile(statePath, "active", "utf8");
		process.env.CBMEM_TEST_COMMITTED_PIDS = "123,456";
		try {
			await verifyCodebaseMemoryDaemonClient(
				fixtureBinary,
				fixtureDirectory,
				456,
				new AbortController().signal,
			);
			await assert.rejects(
				verifyCodebaseMemoryDaemonClient(
					fixtureBinary,
					fixtureDirectory,
					789,
					new AbortController().signal,
				),
				/MCP child 789 is not committed/u,
			);
		} finally {
			delete process.env.CBMEM_TEST_COMMITTED_PIDS;
		}
	});
});

test("daemon lifecycle notifies only when it starts the permanent daemon", async () => {
	const started = createLifecycleHarness(async () => ({ started: true }));
	const startedContext = lifecycleContext("tui");
	await started.emit("session_start", startedContext.ctx);
	assert.deepEqual(startedContext.notifications, [["Started the Codebase Memory daemon.", "info"]]);

	const existing = createLifecycleHarness(async () => ({ started: false }));
	const existingContext = lifecycleContext("rpc");
	await existing.emit("session_start", existingContext.ctx);
	assert.deepEqual(existingContext.notifications, []);
});

test("session lifecycle closes ready sessions once during replacement and shutdown", async () => {
	const closeCounts: number[] = [];
	const harness = createLifecycleHarness(
		async () => ({ started: false }),
		async (_binary, cwd) => {
			const index = closeCounts.push(0) - 1;
			const session = mockSession(cwd);
			return {
				...session,
				async close() {
					closeCounts[index] = (closeCounts[index] ?? 0) + 1;
				},
			};
		},
	);
	const sessionManager = {};
	const first = lifecycleContext("print", sessionManager);
	const replacement = lifecycleContext("print", sessionManager);
	await harness.emit("session_start", first.ctx);
	await harness.emit("session_start", replacement.ctx);
	assert.deepEqual(closeCounts, [1, 0]);
	await harness.emit("session_shutdown", replacement.ctx);
	await harness.emit("session_shutdown", replacement.ctx);
	assert.deepEqual(closeCounts, [1, 1]);
});

test("daemon lifecycle waits for stale startup cleanup during replacement", async () => {
	let callCount = 0;
	let firstSignal: AbortSignal | undefined;
	let releaseFirstCleanup: (() => void) | undefined;
	let resolveFirstReady: (() => void) | undefined;
	let resolveFirstAbort: (() => void) | undefined;
	const firstReady = new Promise<void>((resolve) => {
		resolveFirstReady = resolve;
	});
	const firstAbort = new Promise<void>((resolve) => {
		resolveFirstAbort = resolve;
	});
	const ensureDaemon: DaemonEnsurer = async (_binary, _cwd, signal) => {
		callCount += 1;
		if (callCount > 1) return { started: false };
		firstSignal = signal;
		resolveFirstReady?.();
		return await new Promise((_resolve, reject) => {
			signal.addEventListener(
				"abort",
				() => {
					resolveFirstAbort?.();
					releaseFirstCleanup = () => reject(signal.reason);
				},
				{ once: true },
			);
		});
	};
	const harness = createLifecycleHarness(ensureDaemon);
	const sessionManager = {};
	const first = lifecycleContext("tui", sessionManager);
	const replacementContext = lifecycleContext("tui", sessionManager);
	const firstStartup = harness.emit("session_start", first.ctx);
	await firstReady;

	let replacementSettled = false;
	const replacement = harness.emit("session_start", replacementContext.ctx).then(() => {
		replacementSettled = true;
	});
	await firstAbort;
	await Promise.resolve();
	assert.equal(firstSignal?.aborted, true);
	assert.equal(callCount, 1);
	assert.equal(replacementSettled, false);

	releaseFirstCleanup?.();
	await firstStartup;
	await replacement;

	assert.equal(callCount, 2);
	assert.deepEqual(first.notifications, []);
	assert.deepEqual(replacementContext.notifications, []);
});

test("daemon lifecycle waits for startup cleanup during shutdown", async () => {
	let startupSignal: AbortSignal | undefined;
	let releaseCleanup: (() => void) | undefined;
	let resolveReady: (() => void) | undefined;
	let resolveAbort: (() => void) | undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const aborted = new Promise<void>((resolve) => {
		resolveAbort = resolve;
	});
	const ensureDaemon: DaemonEnsurer = async (_binary, _cwd, signal) => {
		startupSignal = signal;
		resolveReady?.();
		return await new Promise((_resolve, reject) => {
			signal.addEventListener(
				"abort",
				() => {
					resolveAbort?.();
					releaseCleanup = () => reject(signal.reason);
				},
				{ once: true },
			);
		});
	};
	const harness = createLifecycleHarness(ensureDaemon);
	const context = lifecycleContext("tui");
	const startup = harness.emit("session_start", context.ctx);
	await ready;

	let shutdownSettled = false;
	const shutdown = harness.emit("session_shutdown", context.ctx).then(() => {
		shutdownSettled = true;
	});
	await aborted;
	await Promise.resolve();
	assert.equal(startupSignal?.aborted, true);
	assert.equal(shutdownSettled, false);

	releaseCleanup?.();
	await shutdown;
	await startup;

	assert.equal(shutdownSettled, true);
	assert.deepEqual(context.notifications, []);
});

test("daemon lifecycle isolates startup work by session manager", async () => {
	const signals: AbortSignal[] = [];
	let resolveFirstReady: (() => void) | undefined;
	let resolveSecondReady: (() => void) | undefined;
	const firstReady = new Promise<void>((resolve) => {
		resolveFirstReady = resolve;
	});
	const secondReady = new Promise<void>((resolve) => {
		resolveSecondReady = resolve;
	});
	const ensureDaemon: DaemonEnsurer = async (_binary, _cwd, signal) => {
		signals.push(signal);
		if (signals.length === 1) resolveFirstReady?.();
		if (signals.length === 2) resolveSecondReady?.();
		return await new Promise((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		});
	};
	const harness = createLifecycleHarness(ensureDaemon);
	const first = lifecycleContext("print", {});
	const second = lifecycleContext("print", {});
	const firstStartup = harness.emit("session_start", first.ctx);
	await firstReady;
	const secondStartup = harness.emit("session_start", second.ctx);
	await secondReady;

	assert.equal(signals[0]?.aborted, false);
	assert.equal(signals[1]?.aborted, false);
	await harness.emit("session_shutdown", second.ctx);
	await harness.emit("session_shutdown", second.ctx);
	assert.equal(signals[0]?.aborted, false);
	assert.equal(signals[1]?.aborted, true);
	await harness.emit("session_shutdown", first.ctx);
	await Promise.all([firstStartup, secondStartup]);
	assert.equal(signals[0]?.aborted, true);
});

test("daemon lifecycle exposes startup failures safely in UI and non-UI modes", async () => {
	const harness = createLifecycleHarness(async () => {
		throw new Error("failed\u001b[31m badly");
	});
	const tui = lifecycleContext("tui");
	await harness.emit("session_start", tui.ctx);
	assert.deepEqual(tui.notifications, [
		["Could not start the Codebase Memory session: failed badly", "warning"],
	]);

	const print = lifecycleContext("print");
	await assert.rejects(
		harness.emit("session_start", print.ctx),
		/Could not start the Codebase Memory session: failed badly/u,
	);
	assert.deepEqual(print.notifications, []);
});

test("@current routes read-only graph tools and annotates the resolved project", async () => {
	const resolution: ProjectResolution = {
		kind: "borrowed",
		project: "source-project",
		currentRoot: "/worktree",
		sourceRoot: "/source",
		headSha: "a".repeat(40),
	};
	let revalidated = 0;
	const tools = await registerTools(
		fixtureBinary,
		resolutionService(resolution, async () => {
			revalidated += 1;
		}),
	);
	const result = await executeTool(
		tools,
		"search_graph",
		{ project: "@current", name_pattern: ".*Answer.*" },
		toolContext(async () => true),
	);
	const payload = JSON.parse(resultText(result)) as {
		args?: Record<string, unknown>;
		pi_cbmem_resolution?: Record<string, unknown>;
	};

	assert.equal(payload.args?.project, "source-project");
	assert.equal(payload.pi_cbmem_resolution?.kind, "borrowed_canonical_base");
	assert.equal(payload.pi_cbmem_resolution?.current_root, "/worktree");
	assert.equal(revalidated, 1);
	assert.deepEqual((result.details as CbmemToolDetails).projectResolution, resolution);
});

test("@current rejects filesystem-bound and mutating tools before resolution", async () => {
	let resolved = false;
	const tools = await registerTools(
		path.join(fixtureDirectory, "missing-binary"),
		resolutionService(
			{
				kind: "current",
				project: "current-project",
				currentRoot: fixtureDirectory,
				sourceRoot: fixtureDirectory,
				headSha: "a".repeat(40),
			},
			async () => {},
			() => {
				resolved = true;
			},
		),
	);
	for (const name of [
		"search_code",
		"check_index_coverage",
		"detect_changes",
		"delete_project",
		"manage_adr",
		"ingest_traces",
	] as const) {
		await assert.rejects(
			executeTool(
				tools,
				name,
				{ project: "@current" },
				toolContext(async () => true),
			),
			/available only for read-only graph tools/u,
		);
	}
	assert.equal(resolved, false);
});

test("borrowed snippets are read from and point to the current worktree", async () => {
	const sourceRoot = await mkdtemp(path.join(fixtureDirectory, "snippet-source-"));
	const currentRoot = await mkdtemp(path.join(fixtureDirectory, "snippet-current-"));
	const sourcePath = path.join(sourceRoot, "example.ts");
	const currentPath = path.join(currentRoot, "example.ts");
	await writeFile(sourcePath, "first\nsource copy\nthird\n", "utf8");
	await writeFile(currentPath, `first\ncurrent copy\n${"x".repeat(4 * 1024 * 1024)}`, "utf8");
	const resolution: ProjectResolution = {
		kind: "borrowed",
		project: "source-project",
		currentRoot,
		sourceRoot,
		headSha: "a".repeat(40),
	};
	const tools = await registerTools(fixtureBinary, resolutionService(resolution));
	const result = await executeTool(
		tools,
		"get_code_snippet",
		{
			project: "@current",
			qualified_name: "source-project.example.answer",
			testMode: "snippet",
			sourcePath,
		},
		toolContext(async () => true),
	);
	const payload = JSON.parse(resultText(result)) as {
		file_path?: string;
		source?: string;
		pi_cbmem_resolution?: Record<string, unknown>;
	};

	assert.equal(payload.file_path, currentPath);
	assert.equal(payload.source, "current copy\n");
	assert.equal(payload.pi_cbmem_resolution?.kind, "borrowed_canonical_base");

	await assert.rejects(
		executeTool(
			tools,
			"get_code_snippet",
			{
				project: "@current",
				qualified_name: "source-project.escape",
				testMode: "snippet",
				sourcePath: path.join(sourceRoot, "..", "escape.ts"),
			},
			toolContext(async () => true),
		),
		/escapes the canonical project root/u,
	);
});

test("project resolution refuses to corrupt JSON when metadata exceeds output bounds", async () => {
	const resolution: ProjectResolution = {
		kind: "current",
		project: "current-project",
		currentRoot: fixtureDirectory,
		sourceRoot: fixtureDirectory,
		headSha: "a".repeat(40),
	};
	const tools = await registerTools(fixtureBinary, resolutionService(resolution));
	await assert.rejects(
		executeTool(
			tools,
			"search_graph",
			{ project: "@current", testMode: "nearLimit" },
			toolContext(async () => true),
		),
		/project-resolved output exceeded.*refusing to return truncated structured data/u,
	);
});

test("borrowed snippet range reads honor cancellation", async () => {
	const path = await makeLargeSnippetFile("cancel-range-", "x".repeat(8 * 1024 * 1024));
	const controller = new AbortController();
	const pending = readLineRange(path, 2, 2, controller.signal);
	controller.abort();
	await assert.rejects(pending, (error: Error) => error.name === "AbortError");
});

test("borrowed results are discarded when post-call revalidation fails", async () => {
	const resolution: ProjectResolution = {
		kind: "borrowed",
		project: "source-project",
		currentRoot: "/worktree",
		sourceRoot: "/source",
		headSha: "a".repeat(40),
	};
	const tools = await registerTools(
		fixtureBinary,
		resolutionService(resolution, async () => {
			throw new Error("snapshot changed during call");
		}),
	);
	await assert.rejects(
		executeTool(
			tools,
			"search_graph",
			{ project: "@current" },
			toolContext(async () => true),
		),
		/snapshot changed during call/u,
	);
});

test("destructive tools require observable confirmation before spawning", async () => {
	const tools = await registerTools(fixtureBinary);
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

	const unavailableTools = await registerTools(path.join(fixtureDirectory, "missing-binary"));
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

test("tool result rendering sanitizes display text without changing model-visible output", async () => {
	const tool = (await registerTools(fixtureBinary)).find(({ name }) => name === "search_graph");
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

test("MCP results preserve UTF-8 output and daemon-backed bridge evidence", async () => {
	const cwd = await mkdtemp(path.join(fixtureDirectory, "cwd-"));
	const result = await callCodebaseMemory(
		mockSession(cwd),
		"list_projects",
		{ testMode: "splitUtf8" },
		undefined,
	);

	assert.deepEqual(JSON.parse(resultText(result)), { cwd, text: "你好🙂" });
	assert.equal(result.details.truncated, false);
	assert.deepEqual(result.details.bridge, bridgeEvidence);
});

test("validated MCP output is bounded by Pi's line limit", async () => {
	const result = await callCodebaseMemory(
		mockSession(fixtureDirectory),
		"query_graph",
		{ testMode: "manyLines" },
		undefined,
	);
	const text = resultText(result);
	assert.equal(result.details.truncated, true);
	assert.match(text, /additional output was omitted/);
	assert.ok(Buffer.byteLength(text, "utf8") <= DEFAULT_MAX_BYTES);
	assert.ok(countLines(text) <= DEFAULT_MAX_LINES);
});

test("byte-oversized MCP content rejects before returning partial JSON", async () => {
	for (const testMode of ["large", "largeMalformed"]) {
		await assert.rejects(
			callCodebaseMemory(mockSession(fixtureDirectory), "query_graph", { testMode }, undefined),
			/exceeded 50(?:\.0)?KB before a complete JSON response could be returned/,
		);
	}
});

test("MCP protocol, tool, and response failures reject", async () => {
	await assert.rejects(
		callCodebaseMemory(failingSession(new Error("ENOENT")), "list_projects", {}, undefined),
		/ENOENT/,
	);
	await assert.rejects(
		callCodebaseMemory(
			mockSession(fixtureDirectory),
			"list_projects",
			{ testMode: "toolError" },
			undefined,
		),
		/codebase-memory-mcp list_projects failed: important failure/,
	);
	await assert.rejects(
		callCodebaseMemory(
			mockSession(fixtureDirectory),
			"list_projects",
			{ testMode: "noJson" },
			undefined,
		),
		/returned invalid JSON/,
	);
});

test("pre-aborted calls reject before sending an MCP request", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	const session = mockSession(fixtureDirectory, () => {
		calls += 1;
	});
	await assert.rejects(
		callCodebaseMemory(session, "delete_project", {}, controller.signal),
		(error: Error) => error.name === "AbortError",
	);
	assert.equal(calls, 0);
});

test("bundled skill enforces graph-first evidence and valid project-scoped calls", async () => {
	const skillDirectory = path.join(packageDirectory, "skills");
	const skill = await readFile(path.join(skillDirectory, "codebase-memory", "SKILL.md"), "utf8");
	const packageManifest = JSON.parse(
		await readFile(path.resolve(packageDirectory, "package.json"), "utf8"),
	) as { pi?: { skills?: string[] } };

	assert.ok(packageManifest.pi?.skills?.includes("./skills"));

	for (const evidence of [
		/always prefer MCP graph tools/i,
		/## Priority Order/,
		/## When to Fall Back to Grep\/Glob/,
		/Scout \(Tier 1\)/,
		/Verify \(Tier 2, default\)/,
		/Auditor \(Tier 3\)/,
		/check_index_coverage` once with every evidence path/,
		/project="@current"/,
		/borrowed_canonical_base/,
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
			calls.every((call) => /project="(?:<name>|@current)"/u.test(call[1] ?? "")),
			`expected every documented ${tool} call to include an exact project or @current`,
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

function createLifecycleHarness(
	ensureDaemon: DaemonEnsurer,
	createSession: CodebaseMemorySessionFactory = async (_binary, cwd) => mockSession(cwd),
) {
	const handlers = new Map<string, LifecycleHandler[]>();
	const api = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool() {},
	} as unknown as ExtensionAPI;
	cbmem(api, fixtureBinary, undefined, ensureDaemon, createSession, async () => {});
	return {
		async emit(event: string, ctx: ExtensionContext) {
			for (const handler of handlers.get(event) ?? []) await handler({} as never, ctx);
		},
	};
}

function lifecycleContext(mode: ExtensionContext["mode"], sessionManager: object = {}) {
	const notifications: Array<[string, string | undefined]> = [];
	const ctx = {
		cwd: fixtureDirectory,
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		sessionManager,
		ui: {
			notify(message: string, level?: string) {
				notifications.push([message, level]);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, notifications };
}

async function withDaemonFixture(
	statePath: string,
	logPath: string,
	callback: () => Promise<void>,
): Promise<void> {
	const previousState = process.env.CBMEM_TEST_DAEMON_STATE;
	const previousLog = process.env.CBMEM_TEST_DAEMON_LOG;
	const previousFailure = process.env.CBMEM_TEST_DAEMON_START_FAIL;
	const previousWaitReady = process.env.CBMEM_TEST_DAEMON_WAIT_READY;
	process.env.CBMEM_TEST_DAEMON_STATE = statePath;
	process.env.CBMEM_TEST_DAEMON_LOG = logPath;
	delete process.env.CBMEM_TEST_DAEMON_START_FAIL;
	delete process.env.CBMEM_TEST_DAEMON_WAIT_READY;
	try {
		await callback();
	} finally {
		if (previousState === undefined) delete process.env.CBMEM_TEST_DAEMON_STATE;
		else process.env.CBMEM_TEST_DAEMON_STATE = previousState;
		if (previousLog === undefined) delete process.env.CBMEM_TEST_DAEMON_LOG;
		else process.env.CBMEM_TEST_DAEMON_LOG = previousLog;
		if (previousFailure === undefined) delete process.env.CBMEM_TEST_DAEMON_START_FAIL;
		else process.env.CBMEM_TEST_DAEMON_START_FAIL = previousFailure;
		if (previousWaitReady === undefined) delete process.env.CBMEM_TEST_DAEMON_WAIT_READY;
		else process.env.CBMEM_TEST_DAEMON_WAIT_READY = previousWaitReady;
	}
}

async function registerTools(
	binary: string,
	projectResolutionService?: ProjectResolutionService,
): Promise<ToolDefinition[]> {
	const tools: ToolDefinition[] = [];
	const handlers = new Map<string, LifecycleHandler[]>();
	const api = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
	} as unknown as ExtensionAPI;
	cbmem(
		api,
		binary,
		projectResolutionService,
		async () => ({ started: false }),
		async (_binary, cwd) => mockSession(cwd),
		async () => {},
	);
	const ctx = toolContext(async () => true);
	for (const handler of handlers.get("session_start") ?? []) await handler({} as never, ctx);
	return tools;
}

function resolutionService(
	resolution: ProjectResolution,
	revalidate: ProjectResolutionService["revalidate"] = async () => {},
	onResolve: () => void = () => {},
): ProjectResolutionService {
	return {
		async resolve() {
			onResolve();
			return resolution;
		},
		revalidate,
	};
}

function toolContext(
	confirm: (title: string, message: string, options?: { signal?: AbortSignal }) => Promise<boolean>,
	mode: "tui" | "rpc" | "print" | "json" = "tui",
): ExtensionContext {
	return {
		cwd: fixtureDirectory,
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		sessionManager: toolSessionManager,
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

const bridgeEvidence = {
	transport: "mcp-stdio" as const,
	daemonBacked: true as const,
	serverPid: 123,
};

function mockSession(
	cwd: string,
	onCall: () => void = () => {},
	serverPid = bridgeEvidence.serverPid,
): CodebaseMemorySession {
	const bridge = { ...bridgeEvidence, serverPid };
	return {
		bridge,
		async callTool(tool, args, signal) {
			signal?.throwIfAborted();
			onCall();
			let text: string;
			let isError = false;
			switch (args.testMode) {
				case "splitUtf8":
					text = JSON.stringify({ cwd, text: "你好🙂" });
					break;
				case "large":
					text = JSON.stringify({ payload: "界".repeat(30_000), tail: "must-not-appear" });
					break;
				case "largeMalformed":
					text = "not-json".repeat(10_000);
					break;
				case "nearLimit":
					text = JSON.stringify({ payload: "x".repeat(51_000) });
					break;
				case "manyLines":
					text = JSON.stringify(
						{ rows: Array.from({ length: 2_500 }, (_, index) => index) },
						null,
						2,
					);
					break;
				case "toolError":
					text = "important failure";
					isError = true;
					break;
				case "noJson":
					text = "not a JSON response";
					break;
				case "snippet":
					text = JSON.stringify({
						name: "answer",
						qualified_name: "source-project.example.answer",
						label: "Variable",
						file_path: args.sourcePath,
						start_line: 2,
						end_line: 2,
						source: "source copy\n",
					});
					break;
				default:
					text = JSON.stringify({ ok: true, args, tool });
			}
			return {
				content: [{ type: "text", text }],
				isError,
				bridge,
			};
		},
		async close() {},
	};
}

function failingSession(error: Error): CodebaseMemorySession {
	return {
		bridge: bridgeEvidence,
		async callTool() {
			throw error;
		},
		async close() {},
	};
}

function resultText(result: { content: readonly unknown[] }): string {
	const content = result.content[0] as { type?: unknown; text?: unknown } | undefined;
	assert.equal(content?.type, "text");
	if (typeof content.text !== "string") throw new Error("expected text tool result");
	return content.text;
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

async function makeLargeSnippetFile(prefix: string, content: string): Promise<string> {
	const directory = await mkdtemp(path.join(fixtureDirectory, prefix));
	const file = path.join(directory, "example.ts");
	await writeFile(file, content, "utf8");
	return file;
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
