import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import {
	formatDocumentLines,
	formatDocumentPresentation,
} from "../src/components/document-formatting.js";
import { DocumentSearchController } from "../src/components/document-search.js";
import { prepareMermaidRenderer } from "../src/components/mermaid.js";

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

test("preserves literal matches across exact-document soft wraps", () => {
	const wrapped = formatDocumentPresentation("abcdefgh", { kind: "text" }, 4, theme);
	assert.deepEqual(wrapped.softWrapAfter, [true, false]);
	const controller = search(wrapped.searchLines, "def");
	controller.updateLines(wrapped.searchLines, wrapped.softWrapAfter);
	assert.equal(controller.count, 1);
	assert.deepEqual(controller.highlight(wrapped.lines, theme).map(stripVTControlCharacters), [
		"abcd",
		"efgh",
	]);

	const explicitLines = formatDocumentPresentation("abcd\nefgh", { kind: "text" }, 4, theme);
	controller.updateLines(explicitLines.searchLines, explicitLines.softWrapAfter);
	assert.equal(controller.count, 0);
});

test("preserves Markdown tokens across soft wraps without joining source lines", () => {
	const wrapped = formatDocumentPresentation("abcdefgh", { kind: "markdown" }, 4, theme);
	assert.deepEqual(wrapped.softWrapAfter, [true, false]);
	const controller = search(wrapped.searchLines, "def");
	controller.updateLines(
		wrapped.searchLines,
		wrapped.softWrapAfter,
		wrapped.ignoreLeadingWhitespace,
	);
	assert.equal(controller.count, 1);

	const list = formatDocumentPresentation("- abcdefgh", { kind: "markdown" }, 4, theme);
	controller.updateLines(list.searchLines, list.softWrapAfter, list.ignoreLeadingWhitespace);
	assert.equal(controller.count, 1);

	const quote = formatDocumentPresentation("> abcdefghijklmnop", { kind: "markdown" }, 6, theme);
	assert.deepEqual(quote.softWrapAfter, [true, true, true, false]);
	controller.updateLines(quote.searchLines, quote.softWrapAfter, quote.ignoreLeadingWhitespace);
	assert.equal(controller.count, 1);

	const explicitQuote = formatDocumentPresentation(
		"> abcd\n> efgh",
		{ kind: "markdown" },
		6,
		theme,
	);
	assert.deepEqual(explicitQuote.softWrapAfter, [false, false]);
	controller.updateLines(
		explicitQuote.searchLines,
		explicitQuote.softWrapAfter,
		explicitQuote.ignoreLeadingWhitespace,
	);
	assert.equal(controller.count, 0);

	const table = formatDocumentPresentation(
		"| a | b |\n|---|---|\n| abcdefgh | qrstuvwxyz |",
		{ kind: "markdown" },
		10,
		theme,
	);
	controller.updateLines(
		table.searchLines,
		table.softWrapAfter,
		table.ignoreLeadingWhitespace,
		table.searchSources,
	);
	assert.equal(controller.count, 1);

	const spacedTable = formatDocumentPresentation(
		"| value |\n|---|\n| alpha beta |",
		{ kind: "markdown" },
		8,
		theme,
	);
	const spacedSearch = search(spacedTable.searchLines, "alpha beta");
	spacedSearch.updateLines(
		spacedTable.searchLines,
		spacedTable.softWrapAfter,
		spacedTable.ignoreLeadingWhitespace,
		spacedTable.searchSources,
	);
	assert.equal(spacedSearch.count, 1);
	spacedSearch.close();
	spacedSearch.activate(
		spacedTable.searchLines,
		spacedTable.softWrapAfter,
		spacedTable.ignoreLeadingWhitespace,
		spacedTable.searchSources,
	);
	spacedSearch.handleInput("hab");
	assert.equal(spacedSearch.count, 0);

	const explicitLines = formatDocumentPresentation("abcd\nefgh", { kind: "markdown" }, 4, theme);
	assert.deepEqual(explicitLines.softWrapAfter, [false, false]);
	controller.updateLines(
		explicitLines.searchLines,
		explicitLines.softWrapAfter,
		explicitLines.ignoreLeadingWhitespace,
	);
	assert.equal(controller.count, 0);

	const repeated = formatDocumentPresentation(
		"abcd\nefgh\n\nabcdefgh",
		{ kind: "markdown" },
		4,
		theme,
	);
	controller.updateLines(
		repeated.searchLines,
		repeated.softWrapAfter,
		repeated.ignoreLeadingWhitespace,
	);
	assert.equal(controller.count, 1);
});

test("uses one width-sensitive Markdown transform for display and search metadata", async () => {
	await prepareMermaidRenderer();
	const presentation = formatDocumentPresentation(
		"```mermaid\nflowchart LR\n abcdefghijklmnop --> qrstuvwxyz\n```",
		{ kind: "markdown" },
		10,
		theme,
	);
	const controller = search(presentation.searchLines, "jkl");
	controller.updateLines(
		presentation.searchLines,
		presentation.softWrapAfter,
		presentation.ignoreLeadingWhitespace,
	);
	assert.equal(controller.count, 1);
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
	controller.activate(["safelink"]);
	controller.handleInput("\u001b[200~safe\u001b]8;;https://exa");
	controller.handleInput("mple.test\u0007link\u001b[201~");
	assert.equal(controller.input.getValue(), "safelink");
	assert.equal(controller.count, 1);
	controller.close();
	controller.activate(["a.b a-b"]);
	controller.handleInput("a.b");
	assert.equal(controller.count, 1);
	controller.close();
	controller.activate(["same"]);
	assert.equal(controller.count, 0);
});

test("normalizes whitespace for matching without moving the input cursor", () => {
	const controller = new DocumentSearchController();
	controller.activate(["a xb"]);
	controller.handleInput("ab");
	controller.handleInput("\u001b[D");
	controller.handleInput("  ");
	controller.handleInput("x");
	assert.equal(controller.input.getValue(), "a  xb");
	assert.equal(controller.count, 1);
});

test("indexes repetitive documents compactly while retaining count and navigation", () => {
	const line = "a".repeat(100_000);
	const controller = new DocumentSearchController();
	controller.activate(
		[line],
		[],
		[],
		[
			[
				{ row: 0, column: 0, text: "z" },
				{ row: 0, column: 1, text: "z" },
			],
		],
	);
	controller.handleInput("a");
	assert.equal(controller.count, 100_000);
	assert.equal(controller.current, 1);
	controller.previous();
	assert.equal(controller.current, 100_000);
	controller.next();
	assert.equal(controller.current, 1);
	assert.equal(controller.highlight([line], theme).length, 1);
});

test("routes only pasted bytes ahead of surrounding shortcuts", () => {
	const controller = new DocumentSearchController();
	const outsidePaste: string[] = [];
	controller.activate(["needle"]);
	controller.routeInput("before\u001b[200~nee", (data) => {
		outsidePaste.push(data);
		return true;
	});
	const routed = controller.routeInput("dle\u001b[201~\u0003", (data) => {
		outsidePaste.push(data);
		return false;
	});
	assert.equal(controller.input.getValue(), "needle");
	assert.deepEqual(outsidePaste, ["before", "\u0003"]);
	assert.deepEqual(routed, { changed: true, stopped: true });
});

test("reuses unchanged line content and bounds its compact input", () => {
	const lines = ["repeat repeat"];
	const controller = search(lines, "repeat");
	controller.updateLines([...lines]);
	assert.equal(controller.count, 2);
	assert.ok(visibleWidth(controller.render(8)) <= 8);
});
