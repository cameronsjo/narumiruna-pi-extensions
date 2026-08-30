import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import type { HerdrAgentStateOptions } from "../src/herdr-agent-state.js";

type HerdrModule = typeof import("../src/herdr-agent-state.js");
type HerdrRequest = Parameters<NonNullable<HerdrAgentStateOptions["sendRequest"]>>[0];

const packageRoot = resolve("packages/pi-herdr");
let agentDir: string;
let previousAgentDir: string | undefined;
let herdrModule: HerdrModule;

beforeAll(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "pi-herdr-agent-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	herdrModule = await import("../src/herdr-agent-state.js");
});

afterAll(async () => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	await rm(agentDir, { force: true, recursive: true });
});

function enabledOptions(requests: HerdrRequest[]): HerdrAgentStateOptions {
	return {
		environment: {
			enabled: true,
			paneId: "w1:p2",
			socketEndpoint: "/tmp/herdr.sock",
		},
		now: () => 1234,
		random: () => 0.5,
		sendRequest: async (request) => {
			requests.push(request);
		},
	};
}

async function emit(
	mock: ReturnType<typeof createMockPi>,
	name: string,
	event: Record<string, unknown>,
	ctx: unknown,
): Promise<void> {
	for (const handler of mock.events.get(name) ?? []) await handler(event, ctx);
}

async function flushReporting(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function tuiContext(idle = true) {
	return createMockContext({
		mode: "tui",
		hasUI: true,
		isIdle: () => idle,
		sessionManager: {
			getSessionFile: () => "/sessions/pi.jsonl",
			getSessionId: () => "session-id",
		},
	});
}

function stateRequests(requests: HerdrRequest[]) {
	return requests.filter(({ method }) => method === "pane.report_agent");
}

test("Windows socket endpoints preserve qualified pipes and qualify bare names", () => {
	assert.equal(herdrModule.resolveSocketEndpoint("herdr", "win32"), "\\\\.\\pipe\\herdr");
	assert.equal(
		herdrModule.resolveSocketEndpoint("\\\\.\\pipe\\herdr", "win32"),
		"\\\\.\\pipe\\herdr",
	);
	assert.equal(
		herdrModule.resolveSocketEndpoint("\\\\?\\PIPE\\herdr", "win32"),
		"\\\\?\\PIPE\\herdr",
	);
	assert.equal(herdrModule.resolveSocketEndpoint("/tmp/herdr.sock", "linux"), "/tmp/herdr.sock");
});

test("disabled factory registers no lifecycle work", () => {
	const mock = createMockPi();
	herdrModule.createHerdrAgentStateExtension({
		environment: { enabled: false, paneId: "", socketEndpoint: "" },
	})(mock.pi);
	assert.deepEqual([...mock.events.keys()], []);
});

test("TUI lifecycle reports the session and coalesced agent states", async () => {
	const requests: HerdrRequest[] = [];
	const mock = createMockPi();
	herdrModule.createHerdrAgentStateExtension(enabledOptions(requests))(mock.pi);
	const started = tuiContext();

	await emit(mock, "session_start", { reason: "startup" }, started.ctx);
	await flushReporting();
	assert.equal(requests[0]?.method, "pane.report_agent_session");
	assert.deepEqual(requests[0]?.params, {
		pane_id: "w1:p2",
		source: "herdr:pi",
		agent: "pi",
		seq: requests[0]?.params.seq,
		session_start_source: "startup",
		agent_session_path: "/sessions/pi.jsonl",
	});
	assert.equal(stateRequests(requests).at(-1)?.params.state, "idle");

	await emit(mock, "agent_start", {}, started.ctx);
	await flushReporting();
	assert.equal(stateRequests(requests).at(-1)?.params.state, "working");

	await emit(mock, "agent_settled", {}, started.ctx);
	await flushReporting();
	assert.equal(stateRequests(requests).at(-1)?.params.state, "idle");
});

test("blocked events override working state until every blocker clears", async () => {
	const requests: HerdrRequest[] = [];
	const mock = createMockPi();
	herdrModule.createHerdrAgentStateExtension(enabledOptions(requests))(mock.pi);
	const started = tuiContext(false);
	await emit(mock, "session_start", { reason: "startup" }, started.ctx);
	await flushReporting();

	await emit(
		mock,
		"ui_prompt_start",
		{ reason: "ui_prompt", kind: "confirm", title: "Approval" },
		started.ctx,
	);
	await flushReporting();
	assert.equal(stateRequests(requests).at(-1)?.params.state, "blocked");
	assert.equal(stateRequests(requests).at(-1)?.params.message, "Approval");

	await emit(
		mock,
		"ui_prompt_start",
		{ reason: "ui_prompt", kind: "input", title: "Question" },
		started.ctx,
	);
	await emit(
		mock,
		"ui_prompt_end",
		{ reason: "ui_prompt", kind: "confirm", title: "Approval" },
		started.ctx,
	);
	await flushReporting();
	assert.equal(stateRequests(requests).at(-1)?.params.state, "blocked");

	await emit(
		mock,
		"ui_prompt_end",
		{ reason: "ui_prompt", kind: "input", title: "Question" },
		started.ctx,
	);
	await flushReporting();
	assert.equal(stateRequests(requests).at(-1)?.params.state, "working");
});

test("non-TUI sessions never report state", async () => {
	const requests: HerdrRequest[] = [];
	const mock = createMockPi();
	herdrModule.createHerdrAgentStateExtension(enabledOptions(requests))(mock.pi);
	const started = createMockContext({ mode: "rpc", hasUI: true });
	await emit(mock, "session_start", { reason: "startup" }, started.ctx);
	await emit(mock, "agent_start", {}, started.ctx);
	await emit(mock, "agent_settled", {}, started.ctx);
	await emit(
		mock,
		"ui_prompt_start",
		{ reason: "ui_prompt", kind: "confirm", title: "Hidden" },
		started.ctx,
	);
	await flushReporting();
	assert.deepEqual(requests, []);
});

test("socket transport retries one failed delivery and preserves the request", async () => {
	const socketPath = join(agentDir, "herdr-test.sock");
	const received: HerdrRequest[] = [];
	let connectionCount = 0;
	let reportState!: () => void;
	const stateReceived = new Promise<void>((resolve) => {
		reportState = resolve;
	});
	const server = net.createServer((socket) => {
		connectionCount += 1;
		let input = "";
		socket.on("error", () => {
			// The client closes immediately after Herdr acknowledges delivery.
		});
		socket.on("data", (chunk) => {
			input += chunk.toString();
			const newline = input.indexOf("\n");
			if (newline < 0) return;
			const request = JSON.parse(input.slice(0, newline)) as HerdrRequest;
			received.push(request);
			if (connectionCount === 1) socket.end();
			else socket.write("{}\n");
			if (request.method === "pane.report_agent") reportState();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});

	const mock = createMockPi();
	herdrModule.createHerdrAgentStateExtension({
		environment: { enabled: true, paneId: "w1:p2", socketEndpoint: socketPath },
	})(mock.pi);
	const started = tuiContext();
	try {
		await emit(mock, "session_start", { reason: "startup" }, started.ctx);
		await stateReceived;
		assert.equal(connectionCount, 3);
		assert.equal(received[0]?.id, received[1]?.id);
		assert.equal(received[0]?.method, "pane.report_agent_session");
		assert.equal(received[2]?.params.state, "idle");
	} finally {
		await emit(mock, "session_shutdown", { reason: "quit" }, started.ctx);
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
		await rm(socketPath, { force: true });
	}
});

test("shutdown aborts a delayed session report before it can publish state", async () => {
	const requests: HerdrRequest[] = [];
	let release!: () => void;
	const delayed = new Promise<void>((resolve) => {
		release = resolve;
	});
	let firstSignal: AbortSignal | undefined;
	const mock = createMockPi();
	herdrModule.createHerdrAgentStateExtension({
		...enabledOptions(requests),
		sendRequest: async (request, signal) => {
			requests.push(request);
			firstSignal ??= signal;
			await delayed;
		},
	})(mock.pi);
	const started = tuiContext();

	const starting = emit(mock, "session_start", { reason: "startup" }, started.ctx);
	await flushReporting();
	assert.equal(requests.length, 1);
	const shuttingDown = emit(mock, "session_shutdown", { reason: "reload" }, started.ctx);
	assert.equal(firstSignal?.aborted, true);
	release();
	await Promise.all([starting, shuttingDown]);
	await flushReporting();
	assert.equal(stateRequests(requests).length, 0);

	await emit(
		mock,
		"ui_prompt_start",
		{ reason: "ui_prompt", kind: "confirm", title: "Stale" },
		started.ctx,
	);
	await flushReporting();
	assert.equal(requests.length, 1);
});

test("package resources load one extension and the bundled herdr skill", async () => {
	const loader = new DefaultResourceLoader({
		cwd: agentDir,
		agentDir,
		settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
		additionalSkillPaths: [join(packageRoot, "skills", "herdr", "SKILL.md")],
		noSkills: true,
		noContextFiles: true,
	});
	await loader.reload();

	const extensions = loader.getExtensions();
	assert.deepEqual(extensions.errors, []);
	assert.equal(extensions.extensions.length, 1);
	const skills = loader.getSkills();
	assert.deepEqual(skills.diagnostics, []);
	assert.deepEqual(
		skills.skills.map(({ name }) => name),
		["herdr"],
	);
});
