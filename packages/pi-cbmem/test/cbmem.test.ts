import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import cbmem, { TOOL_NAMES } from "../src/cbmem.js";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("cbmem registers every Codebase Memory tool", () => {
	const registered: Array<{ name: string; run: unknown }> = [];

	cbmem({
		registerTool(tool) {
			registered.push(tool);
		},
	});

	assert.deepEqual(
		registered.map((tool) => tool.name),
		TOOL_NAMES,
	);
	assert.ok(registered.every((tool) => typeof tool.run === "function"));
});

test("bundled skill enforces graph-first evidence and safe subagent handoff", () => {
	const skill = readFileSync(
		path.join(packageDirectory, "skills", "codebase-memory", "SKILL.md"),
		"utf8",
	);

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
});
