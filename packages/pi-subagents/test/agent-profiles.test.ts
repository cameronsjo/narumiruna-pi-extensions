import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
	agentProfilesPath,
	createAgentProfile,
	deleteAgentProfile,
	loadAgentProfile,
	readAgentProfiles,
	renameAgentProfile,
	updateAgentProfile,
} from "../src/agent-profiles.js";

let directory: string;
let previousAgentDirectory: string | undefined;

beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "pi-subagents-agents-"));
	previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
});

afterEach(() => {
	if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
	rmSync(directory, { recursive: true, force: true });
	vi.restoreAllMocks();
});

test("missing settings are side-effect free and empty agent names do not read them", () => {
	assert.deepEqual(readAgentProfiles(), { kind: "missing", profiles: {}, document: {} });
	assert.equal(loadAgentProfile(undefined), undefined);
	assert.equal(loadAgentProfile(""), undefined);
	assert.equal(loadAgentProfile("   "), undefined);
	assert.equal(existsSync(agentProfilesPath()), false);
});

test("loads profiles from the current Pi directory and preserves unknown fields", () => {
	writeAgents({
		reviewer: {
			task: "Review independently.",
			tools: ["read", "grep", "read"],
			timeout: 120,
			thinkingLevel: "high",
			future: { enabled: true },
		},
	});
	assert.deepEqual(loadAgentProfile("reviewer"), {
		task: "Review independently.",
		tools: ["read", "grep"],
		timeout: 120,
		thinkingLevel: "high",
	});

	updateAgentProfile("reviewer", { timeout: 30 });
	const document = readDocument();
	assert.deepEqual(document.reviewer, {
		task: "Review independently.",
		tools: ["read", "grep", "read"],
		timeout: 30,
		thinkingLevel: "high",
		future: { enabled: true },
	});
});

test("creates, updates, renames, and deletes profiles through atomic publications", () => {
	const nestedPath = path.join(directory, "nested", "pi-subagents.json");
	createAgentProfile("reviewer", profile(), { settingsPath: nestedPath });
	assert.equal(existsSync(nestedPath), true);
	assert.deepEqual(readAgentProfiles(nestedPath).kind, "loaded");
	if (process.platform !== "win32") assert.equal(statSync(nestedPath).mode & 0o777, 0o600);

	updateAgentProfile("reviewer", { tools: [], thinkingLevel: "low" }, { settingsPath: nestedPath });
	renameAgentProfile("reviewer", "careful-reviewer", { settingsPath: nestedPath });
	assert.deepEqual(readAgentProfiles(nestedPath), {
		kind: "loaded",
		profiles: {
			"careful-reviewer": {
				task: "Review independently.",
				tools: [],
				timeout: 120,
				thinkingLevel: "low",
			},
		},
		document: {
			"careful-reviewer": {
				task: "Review independently.",
				tools: [],
				timeout: 120,
				thinkingLevel: "low",
			},
		},
	});

	deleteAgentProfile("careful-reviewer", { settingsPath: nestedPath });
	assert.deepEqual(readAgentProfiles(nestedPath), {
		kind: "loaded",
		profiles: {},
		document: {},
	});
	assert.deepEqual(readdirSync(path.dirname(nestedPath)), ["pi-subagents.json"]);
});

test("blocks mutations when existing settings are malformed or invalid", () => {
	writeFileSync(agentProfilesPath(), "{", "utf8");
	assert.match(readAgentProfiles().kind, /invalid/u);
	assert.throws(() => createAgentProfile("reviewer", profile()), /Cannot save invalid/i);
	assert.equal(readFileSync(agentProfilesPath(), "utf8"), "{");

	writeAgents({ reviewer: { ...profile(), timeout: 0 } });
	assert.throws(() => updateAgentProfile("reviewer", { timeout: 30 }), /Cannot save invalid/i);
	assert.equal((readDocument().reviewer as { timeout: number }).timeout, 0);
});

test("settings diagnostics escape terminal controls in paths", () => {
	const unsafePath = path.join(directory, "bad\u001b[31m.json");
	writeFileSync(unsafePath, "{", "utf8");
	const loaded = readAgentProfiles(unsafePath);
	assert.equal(loaded.kind, "invalid");
	assert.equal(loaded.reason.includes("\u001b"), false);
});

test("publication failure preserves the previous file and cleans temporary files", () => {
	writeAgents({ reviewer: profile() });
	const previous = readFileSync(agentProfilesPath(), "utf8");
	assert.throws(
		() =>
			updateAgentProfile(
				"reviewer",
				{ timeout: 30 },
				{
					fileSystem: {
						renameSync: () => {
							throw new Error("injected rename failure");
						},
					},
				},
			),
		/injected rename failure/i,
	);
	assert.equal(readFileSync(agentProfilesPath(), "utf8"), previous);
	assert.deepEqual(readdirSync(directory), ["pi-subagents.json"]);
});

test("rejects missing, malformed, unknown, and invalid selected agents", () => {
	assert.throws(() => loadAgentProfile(null), /must be a string/i);
	assert.throws(() => loadAgentProfile("Reviewer"), /lowercase kebab-case/i);
	assert.throws(() => loadAgentProfile("missing"), /does not exist/i);

	writeFileSync(agentProfilesPath(), "{", "utf8");
	assert.throws(() => loadAgentProfile("reviewer"), /invalid JSON/i);

	writeAgents([]);
	assert.throws(() => loadAgentProfile("reviewer"), /invalid agent profile document/i);

	writeAgents({});
	assert.throws(() => loadAgentProfile("reviewer"), /is not defined/i);
	assert.throws(() => loadAgentProfile("constructor"), /is not defined/i);

	for (const candidate of [
		"not an object",
		{ tools: [], timeout: 30, thinkingLevel: "high" },
		{ task: "x".repeat(50 * 1024 + 1), tools: [], timeout: 30, thinkingLevel: "high" },
		{ task: "Review", timeout: 30, thinkingLevel: "high" },
		{ task: "Review", tools: ["shell"], timeout: 30, thinkingLevel: "high" },
		{ task: "Review", tools: [], thinkingLevel: "high" },
		{ task: "Review", tools: [], timeout: 0, thinkingLevel: "high" },
		{ task: "Review", tools: [], timeout: 30 },
		{ task: "Review", tools: [], timeout: 30, thinkingLevel: "turbo" },
	]) {
		writeAgents({ reviewer: candidate });
		assert.throws(() => loadAgentProfile("reviewer"), /invalid agent profile document/i);
	}
});

test("delete rejects a profile changed after its review", () => {
	writeAgents({ reviewer: profile() });
	const reviewed = readDocument().reviewer;
	updateAgentProfile("reviewer", { task: "Changed after review." });
	assert.throws(
		() => deleteAgentProfile("reviewer", { expectedProfileDocument: reviewed }),
		/changed after the delete review/i,
	);
	assert.equal(loadAgentProfile("reviewer")?.task, "Changed after review.");
});

test("rejects duplicate, missing, and invalid mutation targets", () => {
	writeAgents({ reviewer: profile(), debugger: profile() });
	assert.throws(() => createAgentProfile("reviewer", profile()), /already exists/i);
	assert.throws(() => renameAgentProfile("reviewer", "debugger"), /already exists/i);
	assert.throws(() => updateAgentProfile("missing", { timeout: 1 }), /does not exist/i);
	assert.throws(() => deleteAgentProfile("missing"), /does not exist/i);
	assert.throws(() => renameAgentProfile("reviewer", "Not Valid"), /lowercase kebab-case/i);
	assert.throws(() => updateAgentProfile("reviewer", { timeout: 0 }), /Refusing to save invalid/i);
});

function profile() {
	return {
		task: "Review independently.",
		tools: ["read", "grep"],
		timeout: 120,
		thinkingLevel: "high" as const,
	};
}

function writeAgents(value: unknown): void {
	writeFileSync(agentProfilesPath(), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readDocument(): Record<string, unknown> {
	return JSON.parse(readFileSync(agentProfilesPath(), "utf8")) as Record<string, unknown>;
}
