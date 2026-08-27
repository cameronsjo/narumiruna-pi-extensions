import assert from "node:assert/strict";
import { test } from "vitest";
import {
	boundedModelText,
	MAX_MODEL_TEXT_BYTES,
	MAX_MODEL_TEXT_LINES,
	modelVisibleJson,
} from "../src/model-output.js";

test("bounds model-visible text after sanitization by bytes and lines", () => {
	const byteBounded = boundedModelText(`\u001b[31m${'"\\'.repeat(40 * 1024)}`);
	assert.equal(byteBounded.includes(String.fromCharCode(27)), false);
	assert.ok(Buffer.byteLength(byteBounded, "utf8") <= MAX_MODEL_TEXT_BYTES);
	assert.match(byteBounded, /… \[truncated\]$/u);

	const lineBounded = boundedModelText(
		Array.from({ length: MAX_MODEL_TEXT_LINES + 10 }, (_, index) => `line ${index}`).join("\n"),
	);
	assert.ok(lineBounded.split("\n").length <= MAX_MODEL_TEXT_LINES);
	assert.match(lineBounded, /… \[truncated\]$/u);

	const bothBounded = boundedModelText(
		`${"\n".repeat(MAX_MODEL_TEXT_LINES - 1)}${"x".repeat(60 * 1024)}`,
	);
	assert.ok(Buffer.byteLength(bothBounded, "utf8") <= MAX_MODEL_TEXT_BYTES);
	assert.ok(bothBounded.split("\n").length <= MAX_MODEL_TEXT_LINES);
});

test("bounds JSON only after serialized expansion", () => {
	const raw = '"\\'.repeat(16 * 1024);
	assert.ok(Buffer.byteLength(raw, "utf8") < MAX_MODEL_TEXT_BYTES);
	const serialized = modelVisibleJson({ result: raw }, { indent: 2 });
	assert.ok(Buffer.byteLength(serialized, "utf8") <= MAX_MODEL_TEXT_BYTES);
	assert.match(serialized, /… \[truncated\]$/u);
});
