import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
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
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		thinkingLevel: "high",
		custom: tui.custom,
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

	await activate(tui, "Profile settings");
	assert.match(tui.render().join("\n"), /Type to search/u);
	await activate(tui, "Task prompt");
	await activate(tui, "Edit task prompt");
	assert.match(tui.render().join("\n"), /Complete the assigned task/u);
	paste(tui, " Review the assigned scope and return exact evidence.");
	tui.press("tui.input.submit");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(
		profile(store, "reviewer").task,
		"Complete the assigned task and report the result. Review the assigned scope and return exact evidence.",
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
	assert.equal(profile(store, "reviewer").thinkingLevel, "xhigh");

	tui.press("tui.select.cancel");
	await tui.waitForPending();
	await tui.waitForOpen();
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

test("profile settings and task editing honor remapped standard bindings", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	store.create("reviewer", {
		task: "x",
		tools: ["read"],
		timeout: 30,
		thinkingLevel: "medium",
	});
	const mapping: Record<string, string> = {
		"tui.select.up": "k",
		"tui.select.down": "j",
		"tui.select.pageUp": "u",
		"tui.select.pageDown": "d",
		"tui.select.confirm": "y",
		"tui.select.cancel": "q",
		"tui.input.submit": "s",
		"tui.input.newLine": "n",
	};
	const keybindings: Pick<KeybindingsManager, "matches" | "getKeys"> = {
		matches: (data, binding) => data === mapping[binding],
		getKeys: (binding) => (mapping[binding] ? [mapping[binding] as never] : []),
	};
	const tui = createTuiHarness({ width: 40, rows: 14, keybindings });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	await activateWithBindings(tui, "Settings", "j", "y");
	await activateWithBindings(tui, "reviewer", "j", "y");
	await activateWithBindings(tui, "Profile settings", "j", "y");
	await activateWithBindings(tui, "Thinking level", "j", "y");
	assert.equal(profile(store, "reviewer").thinkingLevel, "high");
	await activateWithBindings(tui, "Task prompt", "j", "y");
	await activateWithBindings(tui, "Edit task prompt", "j", "y");
	tui.send("n");
	paste(tui, "after");
	tui.send("s");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(profile(store, "reviewer").task, "x\nafter");
	assert.match(stripVTControlCharacters(tui.render().join("\n")), /q\s*to go back|q\s*cancel/iu);
	assertWidth(tui, 40);
	tui.press("ctrl+c");
	await running;
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
	await activate(tui, "Profile settings");
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

test("invalid task edits reopen with the raw rejected draft and safe rendering", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	store.create("reviewer", {
		task: "x",
		tools: ["read"],
		timeout: 30,
		thinkingLevel: "medium",
	});
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	await activate(tui, "Settings");
	await activate(tui, "reviewer");
	await activate(tui, "Profile settings");
	await activate(tui, "Task prompt");
	await activate(tui, "Edit task prompt");
	tui.send("\u007f");
	tui.press("tui.input.submit");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.match(context.notifications[0]?.message ?? "", /Task prompt was not saved/i);

	const corrected = "Corrected\u001b[31m task.\nNext line.";
	paste(tui, corrected);
	assert.match(stripVTControlCharacters(tui.render().join("\n")), /Corrected \[31m task/u);
	tui.press("tui.input.submit");
	await tui.waitForPending();
	await tui.waitForOpen();
	assert.equal(profile(store, "reviewer").task, corrected);
	tui.press("ctrl+c");
	await running;
});

test("owner replacement settles and disposes an open task editor without saving", async () => {
	const store = createAgentProfileStore(path.join(directory, "pi-subagents.json"));
	store.create("reviewer", {
		task: "Original task.",
		tools: ["read"],
		timeout: 30,
		thinkingLevel: "medium",
	});
	const tui = createTuiHarness({ width: 48, rows: 16 });
	const context = createMockContext({ mode: "tui", hasUI: true, custom: tui.custom });
	const controller = new AbortController();
	const running = showSubagentsMenu(context.ctx, {
		owner: { signal: controller.signal, isCurrent: () => !controller.signal.aborted },
		getActiveJobs: () => [],
		store,
	});
	await tui.waitForOpen();
	await activate(tui, "Settings");
	await activate(tui, "reviewer");
	await activate(tui, "Profile settings");
	await activate(tui, "Task prompt");
	await activate(tui, "Edit task prompt");
	paste(tui, " Stale task must not save.");
	controller.abort(new DOMException("Session replaced", "AbortError"));
	await running;
	assert.equal(tui.isOpen, false);
	assert.equal(profile(store, "reviewer").task, "Original task.");
});

function paste(tui: TuiHarness, text: string): void {
	tui.send(`\u001b[200~${text}\u001b[201~`);
}

async function activateWithBindings(
	tui: TuiHarness,
	label: string,
	down: string,
	confirm: string,
): Promise<void> {
	selectRowWithInput(tui, label, down);
	tui.send(confirm);
	await tui.waitForPending();
	await tui.waitForOpen();
}

async function activate(tui: TuiHarness, label: string): Promise<void> {
	selectRow(tui, label);
	tui.press("tui.select.confirm");
	await tui.waitForPending();
	await tui.waitForOpen();
}

function selectRow(tui: TuiHarness, label: string): void {
	selectRowWithInput(tui, label, "\u001b[B");
}

function selectRowWithInput(tui: TuiHarness, label: string, down: string): void {
	for (let attempt = 0; attempt < 30; attempt++) {
		const selected = tui
			.render()
			.find((line) => (line.includes("→") || line.includes("›")) && line.includes(label));
		if (selected) return;
		tui.send(down);
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
