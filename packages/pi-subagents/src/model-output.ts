import { sanitizeTerminalText } from "./message-broker.js";

export const MAX_MODEL_TEXT_BYTES = 50 * 1024;
export const MAX_MODEL_TEXT_LINES = 2_000;

const TRUNCATION_MARKER = "… [truncated]";

export function boundedModelText(text: string): string {
	let bounded = sanitizeTerminalText(text);
	const bytes = Buffer.from(bounded, "utf8");
	if (bytes.length > MAX_MODEL_TEXT_BYTES) {
		const suffix = `\n${TRUNCATION_MARKER}`;
		const suffixBytes = Buffer.byteLength(suffix, "utf8");
		bounded = `${bytes
			.subarray(0, Math.max(0, MAX_MODEL_TEXT_BYTES - suffixBytes))
			.toString("utf8")
			.replace(/�+$/gu, "")}${suffix}`;
	}
	const lines = bounded.split("\n");
	if (lines.length > MAX_MODEL_TEXT_LINES) {
		bounded = `${lines.slice(0, MAX_MODEL_TEXT_LINES - 1).join("\n")}\n${TRUNCATION_MARKER}`;
	}
	return bounded;
}

export function modelVisibleJson(
	value: unknown,
	options: { prefix?: string; indent?: number } = {},
): string {
	return boundedModelText(`${options.prefix ?? ""}${JSON.stringify(value, null, options.indent)}`);
}
