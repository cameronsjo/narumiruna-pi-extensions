import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Focusable,
	Input,
	sliceByColumn,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalDocument } from "../terminal-document.js";
import { handleSearchInput } from "./rendering.js";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

type SearchTheme = Pick<Theme, "fg"> & Partial<Pick<Theme, "bg" | "underline">>;

interface CellRange {
	row: number;
	start: number;
	end: number;
}

interface DocumentMatch {
	ranges: CellRange[];
}

interface CorpusCell {
	row: number;
	start: number;
	end: number;
}

export class DocumentSearchController implements Focusable {
	readonly input = new Input();
	active = false;
	private parentFocused = false;
	private lines: readonly string[] = [];
	private softWrapAfter: readonly boolean[] = [];
	private corpus = "";
	private cells: Array<CorpusCell | undefined> = [];
	private matches: DocumentMatch[] = [];
	private currentIndex = 0;
	private pasting = false;

	get focused() {
		return this.parentFocused;
	}

	set focused(value: boolean) {
		this.parentFocused = value;
		this.syncFocus();
	}

	get count() {
		return this.matches.length;
	}

	get current() {
		return this.matches.length === 0 ? 0 : this.currentIndex + 1;
	}

	get currentRow() {
		return this.matches[this.currentIndex]?.ranges[0]?.row;
	}

	activate(lines: readonly string[], softWrapAfter: readonly boolean[] = []) {
		this.active = true;
		this.updateLines(lines, softWrapAfter);
		this.syncFocus();
	}

	close() {
		this.active = false;
		this.input.setValue("");
		this.matches = [];
		this.currentIndex = 0;
		this.pasting = false;
		this.syncFocus();
	}

	updateLines(lines: readonly string[], softWrapAfter: readonly boolean[] = []) {
		if (sameLines(this.lines, lines) && sameValues(this.softWrapAfter, softWrapAfter)) return;
		this.lines = [...lines];
		this.softWrapAfter = [...softWrapAfter];
		const corpus = buildCorpus(lines, softWrapAfter);
		this.corpus = corpus.text;
		this.cells = corpus.cells;
		this.rebuildMatches();
	}

	shouldHandleBeforeShortcuts(data: string) {
		return this.pasting || data.includes(PASTE_START);
	}

	handleInput(data: string) {
		const previous = this.input.getValue();
		const pasted = sanitizePastedSearchData(data, this.pasting);
		this.pasting = pasted.pasting;
		handleSearchInput(this.input, pasted.data);
		const sanitized = sanitizeTerminalDocument(this.input.getValue()).replace(/\s+/gu, " ");
		if (sanitized !== this.input.getValue()) this.input.setValue(sanitized);
		if (this.input.getValue() === previous) return false;
		this.rebuildMatches();
		return true;
	}

	next() {
		if (this.matches.length > 0) this.currentIndex = (this.currentIndex + 1) % this.matches.length;
		return this.currentRow;
	}

	previous() {
		if (this.matches.length > 0) {
			this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
		}
		return this.currentRow;
	}

	render(width: number): string {
		const prefix = "Find: ";
		const status = this.input.getValue() ? ` ${this.current}/${this.count}` : "";
		const inputWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(status));
		const inputLine = this.input.render(inputWidth)[0] ?? "";
		return truncateToWidth(`${prefix}${inputLine}${status}`, Math.max(1, width), "");
	}

	highlight(lines: readonly string[], theme: SearchTheme): string[] {
		if (!this.active || this.matches.length === 0) return [...lines];
		const rangesByRow = new Map<number, Array<CellRange & { current: boolean }>>();
		for (const [matchIndex, match] of this.matches.entries()) {
			for (const range of match.ranges) {
				const ranges = rangesByRow.get(range.row) ?? [];
				ranges.push({ ...range, current: matchIndex === this.currentIndex });
				rangesByRow.set(range.row, ranges);
			}
		}
		return lines.map((line, row) => styleLine(line, rangesByRow.get(row) ?? [], theme));
	}

	invalidate() {
		this.input.invalidate();
		this.lines = [];
		this.softWrapAfter = [];
		this.corpus = "";
		this.cells = [];
		this.matches = [];
		this.currentIndex = 0;
	}

	dispose() {
		this.close();
		this.parentFocused = false;
		this.syncFocus();
	}

	private syncFocus() {
		this.input.focused = this.parentFocused && this.active;
	}

	private rebuildMatches() {
		const query = normalizeQuery(this.input.getValue());
		this.matches = query ? findMatches(this.corpus, this.cells, query) : [];
		this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.matches.length - 1));
	}
}

function buildCorpus(lines: readonly string[], softWrapAfter: readonly boolean[]) {
	let text = "";
	const cells: Array<CorpusCell | undefined> = [];
	let pendingWhitespace: CorpusCell | undefined;
	const appendWhitespace = () => {
		if (!pendingWhitespace || text.endsWith(" ") || text.length === 0) return;
		text += " ";
		cells.push(pendingWhitespace);
	};
	for (const [row, line] of lines.entries()) {
		let column = 0;
		for (const { segment } of graphemeSegmenter.segment(stripTerminalSequences(line))) {
			const width = visibleWidth(segment);
			const cell = { row, start: column, end: column + width };
			if (/^\s+$/u.test(segment)) {
				pendingWhitespace ??= cell;
			} else {
				appendWhitespace();
				pendingWhitespace = undefined;
				text += segment;
				for (let index = 0; index < segment.length; index += 1) cells.push(cell);
			}
			column += width;
		}
		if (!softWrapAfter[row]) pendingWhitespace ??= { row, start: column, end: column };
	}
	return { text, cells };
}

function sanitizePastedSearchData(data: string, initiallyPasting: boolean) {
	let result = "";
	let offset = 0;
	let pasting = initiallyPasting;
	while (offset < data.length) {
		if (pasting) {
			const end = data.indexOf(PASTE_END, offset);
			if (end < 0) return { data: result + sanitizeSearchQuery(data.slice(offset)), pasting };
			result += sanitizeSearchQuery(data.slice(offset, end)) + PASTE_END;
			offset = end + PASTE_END.length;
			pasting = false;
			continue;
		}
		const start = data.indexOf(PASTE_START, offset);
		if (start < 0) return { data: result + data.slice(offset), pasting };
		result += data.slice(offset, start) + PASTE_START;
		offset = start + PASTE_START.length;
		pasting = true;
	}
	return { data: result, pasting };
}

function sanitizeSearchQuery(value: string) {
	return sanitizeTerminalDocument(value).replace(/\s+/gu, " ");
}

function normalizeQuery(value: string) {
	return sanitizeSearchQuery(value).trim();
}

function findMatches(
	corpus: string,
	cells: readonly (CorpusCell | undefined)[],
	query: string,
): DocumentMatch[] {
	const expression = new RegExp(escapeRegExp(query), "giu");
	return [...corpus.matchAll(expression)].map((match) => {
		const start = match.index;
		const end = start + match[0].length;
		const byRow = new Map<number, CellRange>();
		for (const cell of cells.slice(start, end)) {
			if (!cell || cell.end <= cell.start) continue;
			const range = byRow.get(cell.row);
			if (range) {
				range.start = Math.min(range.start, cell.start);
				range.end = Math.max(range.end, cell.end);
			} else byRow.set(cell.row, { ...cell });
		}
		return { ranges: [...byRow.values()] };
	});
}

function styleLine(
	line: string,
	ranges: readonly (CellRange & { current: boolean })[],
	theme: SearchTheme,
) {
	if (ranges.length === 0) return line;
	let result = "";
	let column = 0;
	for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
		if (range.start < column) continue;
		result += sliceByColumn(line, column, range.start - column, true);
		let target = sliceByColumn(line, range.start, range.end - range.start, true);
		target = theme.fg("searchMatchText", target);
		target = theme.bg?.("searchMatchBg", target) ?? target;
		if (range.current) target = theme.underline?.(target) ?? target;
		result += target;
		column = range.end;
	}
	result += sliceByColumn(line, column, Math.max(0, visibleWidth(line) - column), true);
	return result;
}

function sameLines(left: readonly string[], right: readonly string[]) {
	return left.length === right.length && left.every((line, index) => line === right[index]);
}

function sameValues<T>(left: readonly T[], right: readonly T[]) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
