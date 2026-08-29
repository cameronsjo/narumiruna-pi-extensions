import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { formatDocumentLines } from "../src/components/document-formatting.js";
import { DocumentSearchController } from "../src/components/document-search.js";

initTheme("dark", false);

const theme = {
	fg: (_role: string, text: string) => `\u001b[31m${text}\u001b[39m`,
	bg: (_role: string, text: string) => `\u001b[43m${text}\u001b[49m`,
	bold: (text: string) => text,
	underline: (text: string) => `\u001b[4m${text}\u001b[24m`,
};

function search(lines: readonly string[], query: string) {
	const controller = new DocumentSearchController();
	controller.focused = true;
	controller.activate(lines);
	controller.handleInput(query);
	return controller;
}

test("matches case-insensitive literals across rendered whitespace", () => {
	const controller = search(["Alpha", "  beta", "ALPHA beta"], "alpha beta");
	assert.equal(controller.count, 2);
	assert.equal(controller.current, 1);
	assert.equal(controller.currentRow, 0);
	assert.equal(controller.next(), 2);
	assert.equal(controller.previous(), 0);
});

test("maps combining and wide graphemes to ANSI-safe cell ranges", () => {
	const lines = ["x e\u0301你🙂 y"];
	const controller = search(lines, "e\u0301你");
	const highlighted = controller.highlight(lines, theme);
	assert.equal(controller.count, 1);
	assert.equal(stripVTControlCharacters(highlighted[0] ?? ""), lines[0]);
	assert.equal(visibleWidth(highlighted[0] ?? ""), visibleWidth(lines[0] ?? ""));
	assert.equal(highlighted[0]?.includes("\u001b[43m"), true);
	assert.equal(highlighted[0]?.includes("\u001b[4m"), true);
});

test("searches ANSI-formatted text, code, diff, and rendered Markdown", () => {
	for (const [content, format, query] of [
		["const value = 1;", { kind: "code", language: "typescript" } as const, "VALUE"],
		["+added value", { kind: "diff" } as const, "added"],
		["# Heading\n\nbody value", { kind: "markdown" } as const, "body"],
	] as const) {
		const lines = formatDocumentLines(content, format, 40, theme);
		const controller = search(lines, query);
		assert.equal(controller.count, 1);
		assert.deepEqual(
			controller.highlight(lines, theme).map(stripVTControlCharacters),
			lines.map(stripVTControlCharacters),
		);
	}
});

test("handles empty, absent, repeated, resized, invalidated, and sanitized queries", () => {
	const controller = search(["one one", "two"], "one");
	assert.equal(controller.count, 2);
	controller.updateLines(["one", "one", "two"]);
	assert.equal(controller.count, 2);
	controller.invalidate();
	controller.updateLines(["one"]);
	assert.equal(controller.count, 1);
	controller.close();
	assert.equal(controller.count, 0);
	controller.activate(["safe text"]);
	controller.handleInput("\u001b[200~safe\u001b]8;;https://unsafe.example\u0007\u001b[201~");
	assert.equal(controller.input.getValue(), "safe");
	assert.equal(controller.count, 1);
	controller.close();
	controller.activate(["safe"]);
	controller.handleInput("\u001b[200~sa\u001b]8;;unterminated");
	controller.handleInput("fe\u001b[201~");
	assert.equal(controller.input.getValue(), "safe");
	assert.equal(controller.count, 1);
	controller.close();
	controller.activate(["a.b a-b"]);
	controller.handleInput("a.b");
	assert.equal(controller.count, 1);
	controller.close();
	controller.activate(["same"]);
	assert.equal(controller.count, 0);
});

test("reuses unchanged line content and bounds its compact input", () => {
	const lines = ["repeat repeat"];
	const controller = search(lines, "repeat");
	controller.updateLines([...lines]);
	assert.equal(controller.count, 2);
	assert.ok(visibleWidth(controller.render(8)) <= 8);
});
