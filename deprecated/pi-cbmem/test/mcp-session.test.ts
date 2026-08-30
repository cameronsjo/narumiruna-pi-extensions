import assert from "node:assert/strict";
import { watch } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import { createCodebaseMemorySession } from "../src/mcp-session.js";

let fixtureDirectory: string;
let fixtureBinary: string;

beforeAll(async () => {
	fixtureDirectory = await mkdtemp(path.join(tmpdir(), "pi-cbmem-mcp-session-test-"));
	fixtureBinary = path.join(fixtureDirectory, "mcp-server.cjs");
	await writeFile(
		fixtureBinary,
		`#!/usr/bin/env node
const fs = require("node:fs");
const pending = new Map();
let buffer = "";
function publish(path, value) {
  if (!path) return;
  fs.writeFileSync(path + ".tmp", String(value));
  fs.renameSync(path + ".tmp", path);
}
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
function handle(message) {
  if (message.method === "initialize") {
    publish(process.env.CBMEM_TEST_INITIALIZE_READY, process.pid);
    if (process.env.CBMEM_TEST_NO_INIT === "1") return;
    if (process.env.CBMEM_TEST_INIT_ERROR === "1") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "init failed" } });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "fixture", version: "1" },
      },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "notifications/cancelled") {
    const request = pending.get(message.params.requestId);
    if (request) {
      publish(request.cancelPath, message.params.requestId);
      pending.delete(message.params.requestId);
    }
    return;
  }
  if (message.method !== "tools/call") return;
  const args = message.params.arguments || {};
  if (args.testMode === "wait") {
    pending.set(message.id, args);
    publish(args.readyPath, process.pid);
    return;
  }
  if (args.testMode === "crash") {
    process.stderr.write("server \\u001b[31mcrashed\\u001b[0m\\n");
    process.exit(7);
  }
  if (args.testMode === "rpcError") {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "request failed" } });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({ pid: process.pid, tool: message.params.name, args }),
      }],
      isError: args.testMode === "toolError",
    },
  });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
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

test("persistent MCP session initializes, verifies daemon commitment, and reuses one child", async () => {
	let verifiedPid: number | undefined;
	const session = await createCodebaseMemorySession(
		fixtureBinary,
		fixtureDirectory,
		new AbortController().signal,
		async (_binary, cwd, pid) => {
			assert.equal(cwd, fixtureDirectory);
			verifiedPid = pid;
		},
	);
	try {
		assert.equal(session.bridge.serverPid, verifiedPid);
		const [first, second] = await Promise.all([
			session.callTool("list_projects", {}, undefined),
			session.callTool("search_graph", { project: "demo" }, undefined),
		]);
		for (const response of [first, second]) {
			assert.equal(response.isError, false);
			assert.deepEqual(response.bridge, session.bridge);
			assert.equal(responsePid(response.content), verifiedPid);
		}
		const third = await session.callTool("index_status", { project: "demo" }, undefined);
		assert.equal(responsePid(third.content), verifiedPid);
	} finally {
		await session.close();
		await session.close();
	}
	await waitForProcessExit(verifiedPid);
});

test("request cancellation preserves the MCP process and later calls", async () => {
	const session = await createCodebaseMemorySession(
		fixtureBinary,
		fixtureDirectory,
		new AbortController().signal,
		async () => {},
	);
	const readyPath = path.join(fixtureDirectory, `request-ready-${crypto.randomUUID()}`);
	const cancelPath = path.join(fixtureDirectory, `request-cancel-${crypto.randomUUID()}`);
	const controller = new AbortController();
	try {
		const ready = waitForPublishedPath(readyPath);
		const cancelled = waitForPublishedPath(cancelPath);
		const pending = session.callTool(
			"query_graph",
			{ testMode: "wait", readyPath, cancelPath },
			controller.signal,
		);
		await ready;
		controller.abort();
		await assert.rejects(pending, (error: Error) => error.name === "AbortError");
		await cancelled;
		const next = await session.callTool("list_projects", {}, undefined);
		assert.equal(responsePid(next.content), session.bridge.serverPid);
	} finally {
		await session.close();
	}
});

test("closing a session rejects pending requests and exits the child", async () => {
	const session = await createCodebaseMemorySession(
		fixtureBinary,
		fixtureDirectory,
		new AbortController().signal,
		async () => {},
	);
	const readyPath = path.join(fixtureDirectory, `close-ready-${crypto.randomUUID()}`);
	const ready = waitForPublishedPath(readyPath);
	const pending = session.callTool("query_graph", { testMode: "wait", readyPath }, undefined);
	await ready;
	await session.close();
	await assert.rejects(pending, /Connection closed|session closed/u);
	await waitForProcessExit(session.bridge.serverPid);
});

test("pre-aborted session creation and tool calls send no work", async () => {
	const startup = new AbortController();
	startup.abort();
	await assert.rejects(
		createCodebaseMemorySession(fixtureBinary, fixtureDirectory, startup.signal, async () => {}),
		(error: Error) => error.name === "AbortError",
	);

	const session = await createCodebaseMemorySession(
		fixtureBinary,
		fixtureDirectory,
		new AbortController().signal,
		async () => {},
	);
	try {
		const call = new AbortController();
		call.abort();
		await assert.rejects(
			session.callTool("list_projects", {}, call.signal),
			(error: Error) => error.name === "AbortError",
		);
		const next = await session.callTool("list_projects", {}, undefined);
		assert.equal(responsePid(next.content), session.bridge.serverPid);
	} finally {
		await session.close();
	}
});

test("initialization and daemon verification failures close partial children", async () => {
	await withEnvironment("CBMEM_TEST_INIT_ERROR", "1", async () => {
		let pid: number | undefined;
		const readyPath = path.join(fixtureDirectory, `init-error-${crypto.randomUUID()}`);
		await withEnvironment("CBMEM_TEST_INITIALIZE_READY", readyPath, async () => {
			const ready = waitForPublishedPath(readyPath).then((value) => {
				pid = value;
			});
			await assert.rejects(
				createCodebaseMemorySession(
					fixtureBinary,
					fixtureDirectory,
					new AbortController().signal,
					async () => {},
				),
				/Could not initialize Codebase Memory MCP stdio/u,
			);
			await ready;
		});
		await waitForProcessExit(pid);
	});

	let verificationPid: number | undefined;
	await assert.rejects(
		createCodebaseMemorySession(
			fixtureBinary,
			fixtureDirectory,
			new AbortController().signal,
			async (_binary, _cwd, pid) => {
				verificationPid = pid;
				throw new Error("not committed");
			},
		),
		/Could not initialize Codebase Memory MCP stdio/u,
	);
	await waitForProcessExit(verificationPid);
});

test("bounded initialization timeout closes a non-responsive child", async () => {
	await withEnvironment("CBMEM_TEST_NO_INIT", "1", async () => {
		let pid: number | undefined;
		const readyPath = path.join(fixtureDirectory, `init-timeout-${crypto.randomUUID()}`);
		await withEnvironment("CBMEM_TEST_INITIALIZE_READY", readyPath, async () => {
			const ready = waitForPublishedPath(readyPath).then((value) => {
				pid = value;
			});
			await assert.rejects(
				createCodebaseMemorySession(
					fixtureBinary,
					fixtureDirectory,
					new AbortController().signal,
					async () => {},
					{ initializeTimeoutMs: 50 },
				),
				/Could not initialize Codebase Memory MCP stdio/u,
			);
			await ready;
		});
		await waitForProcessExit(pid);
	});
});

test("protocol errors stay scoped while process exit reports sanitized recovery guidance", async () => {
	const session = await createCodebaseMemorySession(
		fixtureBinary,
		fixtureDirectory,
		new AbortController().signal,
		async () => {},
	);
	await assert.rejects(
		session.callTool("list_projects", { testMode: "rpcError" }, undefined),
		/request failed/u,
	);
	const next = await session.callTool("list_projects", {}, undefined);
	assert.equal(responsePid(next.content), session.bridge.serverPid);
	await assert.rejects(
		session.callTool("list_projects", { testMode: "crash" }, undefined),
		(error: Error) => {
			assert.match(error.message, /run \/reload to reconnect/u);
			assert.match(error.message, /server crashed/u);
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Verify stderr sanitization.
			assert.doesNotMatch(error.message, /\u001b/u);
			return true;
		},
	);
	await assert.rejects(session.callTool("list_projects", {}, undefined), /run \/reload/u);
	await session.close();
});

function responsePid(content: unknown): number {
	assert.ok(Array.isArray(content));
	const first = content[0] as { type?: unknown; text?: unknown } | undefined;
	assert.equal(first?.type, "text");
	assert.equal(typeof first.text, "string");
	return (JSON.parse(first.text as string) as { pid: number }).pid;
}

function waitForPublishedPath(file: string): Promise<number> {
	const watcher = watch(path.dirname(file));
	return new Promise((resolve, reject) => {
		const cleanup = () => watcher.close();
		watcher.on("error", (error) => {
			cleanup();
			reject(error);
		});
		watcher.on("change", async (_event, filename) => {
			if (filename !== path.basename(file)) return;
			try {
				const value = Number(await readFile(file, "utf8"));
				cleanup();
				resolve(value);
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	});
}

async function waitForProcessExit(pid: number | undefined): Promise<void> {
	assert.ok(pid && Number.isSafeInteger(pid));
	const deadline = Date.now() + 1_000;
	while (processExists(pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal(processExists(pid), false, `expected process ${pid} to exit`);
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

async function withEnvironment(name: string, value: string, callback: () => Promise<void>) {
	const previous = process.env[name];
	process.env[name] = value;
	try {
		await callback();
	} finally {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
}
