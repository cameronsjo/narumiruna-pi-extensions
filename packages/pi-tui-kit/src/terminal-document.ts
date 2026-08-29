import { visibleWidth } from "@earendil-works/pi-tui";

const ESC = 0x1b;
const BEL = 0x07;
const CSI = 0x9b;
const ST = 0x9c;
const OSC = 0x9d;
const DCS = 0x90;
const PM = 0x9e;
const APC = 0x9f;
const TAB_SIZE = 4;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Sanitize untrusted multiline terminal text while retaining line feeds and tabs.
 *
 * Keep raw identities and payloads separate from this presentation-only value.
 */
export function sanitizeTerminalDocument(value: string): string {
	const normalized = value.replace(/\r\n?/gu, "\n");
	let output = "";
	for (let index = 0; index < normalized.length; ) {
		const codePoint = normalized.codePointAt(index) ?? 0;
		const length = codePoint > 0xffff ? 2 : 1;
		if (codePoint === ESC) {
			index = skipEscSequence(normalized, index);
			continue;
		}
		if (codePoint === CSI) {
			index = skipCsi(normalized, index + length);
			continue;
		}
		if (codePoint === OSC || codePoint === DCS || codePoint === PM || codePoint === APC) {
			index = skipStringSequence(normalized, index + length, codePoint === OSC);
			continue;
		}
		if (isBidiControl(codePoint)) {
			index += length;
			continue;
		}
		if (codePoint === 0x0a || codePoint === 0x09) {
			output += String.fromCodePoint(codePoint);
		} else if (isControl(codePoint)) {
			output += " ";
		} else {
			output += String.fromCodePoint(codePoint);
		}
		index += length;
	}
	return output;
}

/** Sanitize, expand tabs, and hard-wrap a terminal document by display-cell width. */
export function hardWrapTerminalDocument(value: string, width: number): string[] {
	if (!Number.isFinite(width) || width <= 0) return [""];
	const safeWidth = Math.max(1, Math.floor(width));
	return sanitizeTerminalDocument(value)
		.split("\n")
		.flatMap((line) => hardWrapLine(expandTabs(line), safeWidth));
}

function expandTabs(line: string): string {
	let column = 0;
	let result = "";
	for (const { segment } of graphemeSegmenter.segment(line)) {
		if (segment === "\t") {
			const count = TAB_SIZE - (column % TAB_SIZE);
			result += " ".repeat(count);
			column += count;
			continue;
		}
		result += segment;
		column += visibleWidth(segment);
	}
	return result;
}

function hardWrapLine(line: string, width: number): string[] {
	if (line.length === 0) return [""];
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;
	const flush = () => {
		lines.push(current);
		current = "";
		currentWidth = 0;
	};
	for (const { segment } of graphemeSegmenter.segment(line)) {
		const segmentWidth = visibleWidth(segment);
		if (segmentWidth > width) {
			if (current.length > 0) flush();
			lines.push("?".repeat(width));
			continue;
		}
		if (currentWidth + segmentWidth > width && current.length > 0) flush();
		current += segment;
		currentWidth += segmentWidth;
	}
	if (current.length > 0 || lines.length === 0) lines.push(current);
	return lines;
}

function skipEscSequence(value: string, start: number): number {
	const introducer = value.charCodeAt(start + 1);
	if (introducer === 0x5b) return skipCsi(value, start + 2);
	if (introducer === 0x5d) return skipStringSequence(value, start + 2, true);
	if (introducer === 0x50 || introducer === 0x5e || introducer === 0x5f) {
		return skipStringSequence(value, start + 2, false);
	}
	return skipGenericEscSequence(value, start);
}

function skipGenericEscSequence(value: string, start: number): number {
	let index = start + 1;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code > 0x2f) break;
		index += 1;
	}
	const final = value.charCodeAt(index);
	return final >= 0x30 && final <= 0x7e ? index + 1 : start + 1;
}

function skipCsi(value: string, start: number): number {
	for (let index = start; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0x40 && code <= 0x7e) return index + 1;
	}
	return value.length;
}

function skipStringSequence(value: string, start: number, bellTerminates: boolean): number {
	for (let index = start; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (bellTerminates && code === BEL) return index + 1;
		if (code === ST) return index + 1;
		if (code === ESC && value.charCodeAt(index + 1) === 0x5c) return index + 2;
	}
	return value.length;
}

function isControl(codePoint: number): boolean {
	return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isBidiControl(codePoint: number): boolean {
	return (
		codePoint === 0x061c ||
		codePoint === 0x200e ||
		codePoint === 0x200f ||
		(codePoint >= 0x202a && codePoint <= 0x202e) ||
		(codePoint >= 0x2066 && codePoint <= 0x2069)
	);
}
