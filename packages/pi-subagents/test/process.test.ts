import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
	buildPiArgs,
	childCommunicationBridgePath,
	resolveTimeoutMs,
	runChild,
	terminateWindowsProcessTree,
} from "../src/process.js";
import type { ChildRequest } from "../src/types.js";

let directory: string;
let previousPackageDirectory: string | undefined;

beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-process-"));
	previousPackageDirectory = process.env.PI_PACKAGE_DIR;
});

afterEach(() => {
	if (previousPackageDirectory === undefined) delete process.env.PI_PACKAGE_DIR;
	else process.env.PI_PACKAGE_DIR = previousPackageDirectory;
	rmSync(directory, { recursive: true, force: true });
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test("buildPiArgs isolates the child and preserves selected communication tools", () => {
	const args = buildPiArgs(childRequest());
	assert.deepEqual(args.slice(0, 8), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"-e",
	]);
	assert.equal(args[8], childCommunicationBridgePath());
	assert.equal(args[args.indexOf("--model") + 1], "test-provider/test-model");
	assert.equal(args[args.indexOf("--thinking") + 1], "medium");
	assert.ok(args.includes("--no-approve"));
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls,subagent_ask,subagent_wait");
	assert.doesNotMatch(args.join(" "), /\bbash\b|\bwrite\b|append-system-prompt/u);
	assert.equal(args.at(-1), "Task: task");

	const writable = buildPiArgs(
		childRequest({
			tools: ["read", "bash", "write", "subagent_ask", "subagent_wait"],
			thinkingLevel: "xhigh",
			projectTrusted: true,
		}),
	);
	assert.ok(writable.includes("--approve"));
	assert.equal(writable[writable.indexOf("--thinking") + 1], "xhigh");
	assert.equal(
		writable[writable.indexOf("--tools") + 1],
		"read,bash,write,subagent_ask,subagent_wait",
	);

	const noWorkTools = buildPiArgs(childRequest({ tools: [] }));
	assert.equal(noWorkTools[noWorkTools.indexOf("--tools") + 1], "subagent_ask,subagent_wait");
});

test("runChild classifies completed and partial subprocess output", async () => {
	installFakePi(`
const task = process.argv.at(-1) || "";
const message = (text, stopReason = "stop") => JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason }
});
if (task.includes("partial")) {
  console.log(message("partial evidence", "error"));
  console.error("child failed");
  process.exit(2);
}
console.log(message("completed evidence"));
`);
	const completed = await runChild(childRequest({ task: "complete" }));
	assert.equal(completed.state, "completed");
	assert.equal(completed.result, "completed evidence");

	const partial = await runChild(childRequest({ task: "partial" }));
	assert.equal(partial.state, "partial");
	assert.equal(partial.result, "partial evidence");
	assert.match(partial.error ?? "", /child failed/);
});

test("runChild requires a normal terminal result and preserves incomplete evidence", async () => {
	installFakePi(`
const task = process.argv.at(-1) || "";
const message = (text, stopReason) => JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason }
});
if (task.includes("length")) console.log(message("cut-off evidence", "length"));
else if (task.includes("nonterminal")) console.log(message("intermediate evidence", "toolUse"));
else console.log("{malformed");
`);
	const lengthLimited = await runChild(childRequest({ task: "length" }));
	assert.equal(lengthLimited.state, "partial");
	assert.equal(lengthLimited.result, "cut-off evidence");
	assert.match(lengthLimited.error ?? "", /model limit/i);
	assert.match(lengthLimited.limitations.join("\n"), /model output limit/i);

	const nonterminal = await runChild(childRequest({ task: "nonterminal" }));
	assert.equal(nonterminal.state, "partial");
	assert.equal(nonterminal.result, "intermediate evidence");
	assert.match(nonterminal.error ?? "", /without a terminal assistant result/i);

	const missing = await runChild(childRequest({ task: "missing" }));
	assert.equal(missing.state, "failed");
	assert.match(missing.error ?? "", /without a terminal assistant result/i);
	assert.match(missing.limitations.join("\n"), /malformed/i);
});

test("runChild bounds child result text below the complete tool-output budget", async () => {
	installFakePi(`
const text = "x".repeat(40 * 1024);
console.log(JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
}));
`);
	const result = await runChild(childRequest());
	assert.equal(result.state, "completed");
	assert.equal(result.truncated, true);
	assert.ok(Buffer.byteLength(result.result ?? "", "utf8") <= 32 * 1024);
	assert.match(result.limitations.join("\n"), /truncated/i);
});

test("passes broker credentials through a private descriptor outside the initial environment", async () => {
	installFakePi(`
const initialEnvironment = process.platform === "linux"
  ? fs.readFileSync("/proc/self/environ")
  : Buffer.from(Object.entries(process.env).map(([key, value]) => key + "=" + value).join("\\0"));
const text = JSON.stringify({
  credentialsReceived: brokerCredentials.host === "127.0.0.1" && brokerCredentials.port === 31337,
  initialEnvironmentContainsToken: initialEnvironment.includes(Buffer.from(brokerCredentials.token)),
  descriptorMarker: process.env.PI_SUBAGENT_BROKER_FD,
});
console.log(JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
}));
`);
	const result = await runChild(childRequest());
	assert.equal(result.state, "completed");
	assert.deepEqual(JSON.parse(result.result ?? "{}"), {
		credentialsReceived: true,
		initialEnvironmentContainsToken: false,
		descriptorMarker: "3",
	});
});

test("handles late credential-pipe errors after child launch failure", async () => {
	installFakePi("");
	const removedCwd = path.join(directory, "removed-cwd");
	mkdirSync(removedCwd);
	rmSync(removedCwd, { recursive: true });

	const result = await runChild(childRequest({ cwd: removedCwd }));
	assert.equal(result.state, "failed");
	assert.match(result.error ?? "", /ENOENT|not found/iu);
	await new Promise<void>((resolve) => setImmediate(resolve));
});

test("resolves optional execution timeouts with Pi bash semantics", () => {
	assert.equal(resolveTimeoutMs(undefined), undefined);
	assert.equal(resolveTimeoutMs(0.025), 25);
	assert.equal(resolveTimeoutMs(2_147_483.647), 2_147_483_647);
	assert.throws(() => resolveTimeoutMs(0), /finite number of seconds/);
	assert.throws(() => resolveTimeoutMs(Number.POSITIVE_INFINITY), /finite number of seconds/);
	assert.throws(() => resolveTimeoutMs(2_147_483.648), /maximum is 2147483\.647 seconds/);
});

test("runChild enforces an optional execution timeout and caller cancellation", async () => {
	installFakePi("setInterval(() => {}, 1000);\n");
	const timedOut = await runChild(childRequest({ timeout: 0.025 }));
	assert.equal(timedOut.state, "timed_out");

	const controller = new AbortController();
	const work = runChild(childRequest({ signal: controller.signal }));
	setTimeout(() => controller.abort(), 25);
	const cancelled = await work;
	assert.equal(cancelled.state, "cancelled");
});

test("runChild reuses one termination flow when timeout and cancellation race", {
	skip: process.platform === "win32",
}, async () => {
	installFakePi(`
process.on("SIGTERM", () => undefined);
setInterval(() => {}, 1000);
`);
	const signals: Array<string | number | undefined> = [];
	const originalKill = process.kill.bind(process);
	vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
		if (pid < 0) signals.push(signal);
		return originalKill(pid, signal);
	});
	const controller = new AbortController();
	const work = runChild(childRequest({ signal: controller.signal, timeout: 0.5 }));
	setTimeout(() => controller.abort(), 600);
	const result = await work;
	assert.equal(result.state, "cancelled");
	assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("Windows process-tree termination awaits taskkill completion", async () => {
	const childKill = vi.fn();
	const child = {
		pid: 4242,
		kill: childKill,
	} as unknown as ChildProcess;
	const treeKiller = new EventEmitter() as ChildProcess;
	treeKiller.kill = vi.fn();
	const spawnTreeKillerMock = vi.fn(() => treeKiller);
	const spawnTreeKiller =
		spawnTreeKillerMock as unknown as typeof import("node:child_process").spawn;
	let settled = false;
	const work = terminateWindowsProcessTree(
		child,
		spawnTreeKiller,
		"C:\\Windows\\System32\\taskkill.exe",
	).then(() => {
		settled = true;
	});
	await Promise.resolve();
	assert.equal(settled, false);
	assert.deepEqual(spawnTreeKillerMock.mock.calls[0]?.slice(0, 2), [
		"C:\\Windows\\System32\\taskkill.exe",
		["/PID", "4242", "/T", "/F"],
	]);
	assert.equal(childKill.mock.calls.length, 0);
	treeKiller.emit("close", 0, null);
	await work;
	assert.equal(settled, true);
});

test("Windows process-tree termination bounds a hung taskkill helper", async () => {
	vi.useFakeTimers();
	const childKill = vi.fn();
	const child = {
		pid: 4242,
		kill: childKill,
	} as unknown as ChildProcess;
	const treeKiller = new EventEmitter() as ChildProcess;
	const treeKillerKill = vi.fn();
	treeKiller.kill = treeKillerKill;
	const spawnTreeKiller = vi.fn(
		() => treeKiller,
	) as unknown as typeof import("node:child_process").spawn;
	let settled = false;
	const work = terminateWindowsProcessTree(
		child,
		spawnTreeKiller,
		"C:\\Windows\\System32\\taskkill.exe",
		10,
	).then(() => {
		settled = true;
	});
	await vi.advanceTimersByTimeAsync(9);
	assert.equal(settled, false);
	await vi.advanceTimersByTimeAsync(1);
	await work;
	assert.equal(settled, true);
	assert.deepEqual(treeKillerKill.mock.calls, [["SIGKILL"]]);
	assert.deepEqual(childKill.mock.calls, [["SIGKILL"]]);
});

function childRequest(overrides: Partial<ChildRequest> = {}): ChildRequest {
	return {
		task: "task",
		tools: ["read", "grep", "find", "ls"],
		model: "test-provider/test-model",
		thinkingLevel: "medium",
		cwd: directory,
		projectTrusted: false,
		communication: {
			host: "127.0.0.1",
			port: 31_337,
			token: "a".repeat(64),
		},
		signal: new AbortController().signal,
		...overrides,
	};
}

function installFakePi(source: string): void {
	const packageDirectory = path.join(directory, "pi-core");
	mkdirSync(packageDirectory, { recursive: true });
	writeFileSync(
		path.join(packageDirectory, "fake-pi.mjs"),
		`import fs from "node:fs";\nconst brokerCredentials = JSON.parse(fs.readFileSync(3, "utf8"));\n${source}`,
	);
	writeFileSync(
		path.join(packageDirectory, "package.json"),
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			bin: { pi: "./fake-pi.mjs" },
		}),
	);
	process.env.PI_PACKAGE_DIR = packageDirectory;
}
