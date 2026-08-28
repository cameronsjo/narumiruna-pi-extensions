import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createTuiHarness, type TuiHarness } from "@narumitw/pi-tui-kit/testing";
import { afterEach, beforeEach, test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { createAgentProfileStore } from "../src/agent-profiles.js";
import { showSubagentsMenu } from "../src/menu.js";
import subagents from "../src/subagents.js";

let directory: string;
let previousAgentDirectory: string | undefined;

beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-menu-"));
	previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
});

afterEach(() => {
	if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
	rmSync(directory, { recursive: true, force: true });
});

test("profile manager creates, edits, renames, and deletes one complete profile", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	const tui = createTuiHarness({ width: 48, rows: 18 });
	const editorDrafts: string[] = [];
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		thinkingLevel: "high",
		custom: tui.custom,
		editor: async (_title: string, draft: string) => {
			editorDrafts.push(draft);
			return "Review the assigned scope and return exact evidence.";
		},
	});
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	assertWidth(tui, 48);

	await activate(tui, "Settings");
	await activate(tui, "Create profile");
	tui.setFocused(true);
	tui.type("reviewer");
	tui.press("tui.input.submit");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(store.read().kind, "loaded");
	assert.match(tui.render().join("\n"), /Profile · reviewer/u);

	await activate(tui, "Task prompt");
	assert.deepEqual(editorDrafts, ["Complete the assigned task and report the result."]);
	assert.equal(
		profile(store, "reviewer").task,
		"Review the assigned scope and return exact evidence.",
	);

	await activate(tui, "Tools");
	await activate(tui, "bash");
	assert.deepEqual(profile(store, "reviewer").tools, ["read", "grep", "find", "ls", "bash"]);
	tui.press("tui.select.cancel");
	await tui.waitForPending();
	await tui.waitForOpen();

	await activate(tui, "Timeout");
	tui.setFocused(true);
	tui.type("45");
	tui.press("tui.input.submit");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(profile(store, "reviewer").timeout, 45);

	await activate(tui, "Thinking level");
	tui.press("home");
	tui.press("tui.select.down");
	tui.press("tui.select.down");
	tui.press("tui.select.confirm");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(profile(store, "reviewer").thinkingLevel, "low");

	await activate(tui, "Rename");
	tui.setFocused(true);
	tui.type("careful-reviewer");
	tui.press("tui.input.submit");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(profile(store, "careful-reviewer").timeout, 45);

	await activate(tui, "Delete");
	assert.match(tui.render().join("\n"), /This cannot be\s+undone/u);
	assert.match(tui.render().join("\n"), /"name": "careful-reviewer"/u);
	tui.press("tui.select.confirm");
	await tui.waitForPending();
	await tui.waitForOpen();
	const loaded = store.read();
	if (loaded.kind === "invalid") assert.fail(loaded.reason);
	assert.deepEqual(Object.keys(loaded.profiles), []);

	tui.press("ctrl+c");
	await running;
});

test("invalid settings stay read-only and render safely with remapped bindings", async () => {
	const settingsPath = path.join(directory, "pi-subagents.json");
	writeFileSync(settingsPath, "{", "utf8");
	const store = createAgentProfileStore(settingsPath);
	const mapping: Record<string, string> = {
		"tui.select.up": "k",
		"tui.select.down": "j",
		"tui.select.pageUp": "u",
		"tui.select.pageDown": "d",
		"tui.select.confirm": "y",
		"tui.select.cancel": "q",
	};
	const keybindings: Pick<KeybindingsManager, "matches" | "getKeys"> = {
		matches: (data, binding) => data === mapping[binding],
		getKeys: (binding) => (mapping[binding] ? [mapping[binding] as never] : []),
	};
	const tui = createTuiHarness({ width: 32, rows: 12, keybindings });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	tui.send("y");
	await tui.waitForPending();
	await tui.waitForOpen();
	const frame = tui.render().join("\n");
	assert.match(frame, /Read only/u);
	assert.match(frame, /q back/u);
	assertWidth(tui, 32);
	tui.send("q");
	await tui.waitForPending();
	await tui.waitForOpen();
	tui.press("ctrl+c");
	await running;
	assert.equal(store.read().kind, "invalid");
});

test("profile manager reports save failures and keeps the accepted state", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	store.create("reviewer", {
		task: "Review.",
		tools: ["read"],
		timeout: 30,
		thinkingLevel: "medium",
	});
	const failingStore = {
		...store,
		update: () => {
			throw new Error("injected save failure");
		},
	};
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store: failingStore,
	});
	await tui.waitForOpen();
	await activate(tui, "Settings");
	await activate(tui, "reviewer");
	await activate(tui, "Tools");
	await activate(tui, "bash");
	assert.deepEqual(profile(store, "reviewer").tools, ["read"]);
	assert.match(context.notifications[0]?.message ?? "", /injected save failure/i);
	tui.press("ctrl+c");
	await running;
});

test("session shutdown disposes the registered command menu", async () => {
	const mock = createMockPi();
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	subagents(mock.pi);
	for (const handler of mock.events.get("session_start") ?? []) {
		await handler({ type: "session_start", reason: "startup" }, context.ctx);
	}
	const running = mock.commands.get("subagents")?.handler("", context.ctx);
	await tui.waitForOpen();
	for (const handler of mock.events.get("session_shutdown") ?? []) {
		await handler({ type: "session_shutdown", reason: "quit" }, context.ctx);
	}
	await running;
	assert.equal(tui.isOpen, false);
});

test("invalid task edits reopen with the rejected draft before saving", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	store.create("reviewer", {
		task: "Original task.",
		tools: ["read"],
		timeout: 30,
		thinkingLevel: "medium",
	});
	const drafts: string[] = [];
	const responses = ["", "Corrected task."];
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		custom: tui.custom,
		editor: async (_title: string, draft: string) => {
			drafts.push(draft);
			return responses.shift();
		},
	});
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	await activate(tui, "Settings");
	await activate(tui, "reviewer");
	await activate(tui, "Task prompt");
	assert.deepEqual(drafts, ["Original task.", ""]);
	assert.equal(profile(store, "reviewer").task, "Corrected task.");
	assert.match(context.notifications[0]?.message ?? "", /Task prompt was not saved/i);
	tui.press("ctrl+c");
	await running;
});

test("owner replacement while the task editor is open does not save stale text", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	store.create("reviewer", {
		task: "Original task.",
		tools: ["read"],
		timeout: 30,
		thinkingLevel: "medium",
	});
	let finishEditor!: (value: string | undefined) => void;
	const editorResult = new Promise<string | undefined>((resolve) => {
		finishEditor = resolve;
	});
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		custom: tui.custom,
		editor: async () => editorResult,
	});
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	await activate(tui, "Settings");
	await activate(tui, "reviewer");
	selectRow(tui, "Task prompt");
	tui.press("tui.select.confirm");
	await Promise.resolve();
	controller.abort(new DOMException("Session replaced", "AbortError"));
	finishEditor("Stale task must not save.");
	await tui.waitForPending();
	await running;
	assert.equal(profile(store, "reviewer").task, "Original task.");
});

async function activate(tui: TuiHarness, label: string): Promise<void> {
	selectRow(tui, label);
	tui.press("tui.select.confirm");
	await tui.waitForPending();
	await tui.waitForOpen();
}

function selectRow(tui: TuiHarness, label: string): void {
	for (let attempt = 0; attempt < 30; attempt++) {
		const selected = tui
			.render()
			.find((line) => (line.includes("→") || line.includes("›")) && line.includes(label));
		if (selected) return;
		tui.press("tui.select.down");
	}
	assert.fail(`Could not select row: ${label}\n${tui.render().join("\n")}`);
}

function profile(store: ReturnType<typeof createAgentProfileStore>, name: string) {
	const loaded = store.read();
	if (loaded.kind === "invalid") assert.fail(loaded.reason);
	const value = loaded.profiles[name];
	assert.ok(value);
	return value;
}

function assertWidth(tui: TuiHarness, width: number): void {
	assert.equal(
		tui.render().every((line) => visibleWidth(line) <= width),
		true,
	);
}
