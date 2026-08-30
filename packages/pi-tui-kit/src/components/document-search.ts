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
const MAX_HIGHLIGHTED_MATCHES = 1_000;

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

export interface DocumentSearchSegment {
	row: number;
	column: number;
	text: string;
	separatorBefore?: boolean;
}

export type DocumentSearchSource = readonly DocumentSearchSegment[];

export class DocumentSearchController implements Focusable {
	readonly input = new Input();
	active = false;
	private parentFocused = false;
	private lines: readonly string[] = [];
	private softWrapAfter: readonly boolean[] = [];
	private ignoreLeadingWhitespace: readonly boolean[] = [];
	private searchSources: readonly DocumentSearchSource[] = [];
	private corpus = "";
	private cells: Array<CorpusCell | undefined> = [];
	private matches: DocumentMatch[] = [];
	private compactMatchOffsets: Uint32Array | undefined;
	private currentIndex = 0;
	private pasting = false;
	private pasteBuffer = "";

	get focused() {
		return this.parentFocused;
	}

	set focused(value: boolean) {
		this.parentFocused = value;
		this.syncFocus();
	}

	get count() {
		return this.compactMatchOffsets ? this.compactMatchOffsets.length / 2 : this.matches.length;
	}

	get current() {
		return this.count === 0 ? 0 : this.currentIndex + 1;
	}

	get currentRow() {
		return this.currentMatch()?.ranges[0]?.row;
	}

	activate(
		lines: readonly string[],
		softWrapAfter: readonly boolean[] = [],
		ignoreLeadingWhitespace: readonly boolean[] = [],
		searchSources: readonly DocumentSearchSource[] = [],
	) {
		this.active = true;
		this.updateLines(lines, softWrapAfter, ignoreLeadingWhitespace, searchSources);
		this.syncFocus();
	}

	close() {
		this.active = false;
		this.input.setValue("");
		this.matches = [];
		this.compactMatchOffsets = undefined;
		this.currentIndex = 0;
		this.pasting = false;
		this.pasteBuffer = "";
		this.syncFocus();
	}

	updateLines(
		lines: readonly string[],
		softWrapAfter: readonly boolean[] = [],
		ignoreLeadingWhitespace: readonly boolean[] = [],
		searchSources: readonly DocumentSearchSource[] = [],
	) {
		if (
			sameLines(this.lines, lines) &&
			sameValues(this.softWrapAfter, softWrapAfter) &&
			sameValues(this.ignoreLeadingWhitespace, ignoreLeadingWhitespace) &&
			sameSearchSources(this.searchSources, searchSources)
		) {
			return;
		}
		this.lines = [...lines];
		this.softWrapAfter = [...softWrapAfter];
		this.ignoreLeadingWhitespace = [...ignoreLeadingWhitespace];
		this.searchSources = searchSources.map((source) => source.map((segment) => ({ ...segment })));
		const corpus = buildCorpus(lines, softWrapAfter, ignoreLeadingWhitespace);
		this.corpus = corpus.text;
		this.cells = corpus.cells;
		this.rebuildMatches();
	}

	routeInput(data: string, handleOutsidePaste: (data: string) => boolean) {
		let changed = false;
		let offset = 0;
		while (offset < data.length) {
			if (this.pasting) {
				const end = data.indexOf(PASTE_END, offset);
				const nextOffset = end < 0 ? data.length : end + PASTE_END.length;
				changed = this.handleInput(data.slice(offset, nextOffset)) || changed;
				offset = nextOffset;
				continue;
			}
			const start = data.indexOf(PASTE_START, offset);
			if (start < 0) {
				return {
					changed,
					stopped: !handleOutsidePaste(data.slice(offset)),
				};
			}
			if (start > offset && !handleOutsidePaste(data.slice(offset, start))) {
				return { changed, stopped: true };
			}
			if (!this.active) return { changed, stopped: true };
			const end = data.indexOf(PASTE_END, start + PASTE_START.length);
			const nextOffset = end < 0 ? data.length : end + PASTE_END.length;
			changed = this.handleInput(data.slice(start, nextOffset)) || changed;
			offset = nextOffset;
		}
		return { changed, stopped: false };
	}

	handleInput(data: string) {
		const previous = this.input.getValue();
		const pasted = sanitizePastedSearchData(data, this.pasting, this.pasteBuffer);
		this.pasting = pasted.pasting;
		this.pasteBuffer = pasted.buffer;
		handleSearchInput(this.input, pasted.data);
		const sanitized = sanitizeTerminalDocument(this.input.getValue()).replace(/\s+/gu, " ");
		if (sanitized !== this.input.getValue()) this.input.setValue(sanitized);
		if (this.input.getValue() === previous) return false;
		this.rebuildMatches();
		return true;
	}

	next() {
		if (this.count > 0) this.currentIndex = (this.currentIndex + 1) % this.count;
		return this.currentRow;
	}

	previous() {
		if (this.count > 0) {
			this.currentIndex = (this.currentIndex - 1 + this.count) % this.count;
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
		if (!this.active || this.count === 0) return [...lines];
		const rangesByRow = new Map<number, Array<CellRange & { current: boolean }>>();
		for (const [matchIndex, match] of this.highlightMatches()) {
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
		this.ignoreLeadingWhitespace = [];
		this.searchSources = [];
		this.corpus = "";
		this.cells = [];
		this.matches = [];
		this.compactMatchOffsets = undefined;
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
		this.compactMatchOffsets = undefined;
		if (!query) this.matches = [];
		else if (this.searchSources.length === 0) {
			this.matches = [];
			this.compactMatchOffsets = findMatchOffsets(this.corpus, query);
		} else {
			this.matches = sortMatches(
				uniqueMatches([
					...findMatches(this.corpus, this.cells, query),
					...this.searchSources.flatMap((source) => {
						const corpus = buildSearchSourceCorpus(source);
						return findMatches(corpus.text, corpus.cells, query);
					}),
				]),
			);
		}
		this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.count - 1));
	}

	private currentMatch() {
		if (!this.compactMatchOffsets) return this.matches[this.currentIndex];
		const offsetIndex = this.currentIndex * 2;
		return materializeMatch(
			this.cells,
			this.compactMatchOffsets[offsetIndex] ?? 0,
			this.compactMatchOffsets[offsetIndex + 1] ?? 0,
		);
	}

	private highlightMatches(): Array<[number, DocumentMatch]> {
		if (!this.compactMatchOffsets) return [...this.matches.entries()];
		if (this.count > MAX_HIGHLIGHTED_MATCHES) {
			const current = this.currentMatch();
			return current ? [[this.currentIndex, current]] : [];
		}
		const matches: Array<[number, DocumentMatch]> = [];
		for (let index = 0; index < this.count; index += 1) {
			const offsetIndex = index * 2;
			matches.push([
				index,
				materializeMatch(
					this.cells,
					this.compactMatchOffsets[offsetIndex] ?? 0,
					this.compactMatchOffsets[offsetIndex + 1] ?? 0,
				),
			]);
		}
		return matches;
	}
}

function buildCorpus(
	lines: readonly string[],
	softWrapAfter: readonly boolean[],
	ignoreLeadingWhitespace: readonly boolean[],
) {
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
		let hasContent = false;
		for (const { segment } of graphemeSegmenter.segment(stripTerminalSequences(line))) {
			const width = visibleWidth(segment);
			const cell = { row, start: column, end: column + width };
			if (/^\s+$/u.test(segment)) {
				if (hasContent || !ignoreLeadingWhitespace[row]) pendingWhitespace ??= cell;
			} else {
				appendWhitespace();
				pendingWhitespace = undefined;
				hasContent = true;
				text += segment;
				for (let index = 0; index < segment.length; index += 1) cells.push(cell);
			}
			column += width;
		}
		if (!softWrapAfter[row]) pendingWhitespace ??= { row, start: column, end: column };
	}
	return { text, cells };
}

function buildSearchSourceCorpus(source: DocumentSearchSource) {
	let text = "";
	const cells: Array<CorpusCell | undefined> = [];
	let pendingWhitespace: CorpusCell | undefined;
	const appendWhitespace = () => {
		if (!pendingWhitespace || text.endsWith(" ") || text.length === 0) return;
		text += " ";
		cells.push(pendingWhitespace);
	};
	for (const segment of source) {
		let column = segment.column;
		if (segment.separatorBefore) {
			pendingWhitespace ??= { row: segment.row, start: column, end: column };
		}
		for (const { segment: grapheme } of graphemeSegmenter.segment(segment.text)) {
			const width = visibleWidth(grapheme);
			const cell = { row: segment.row, start: column, end: column + width };
			if (/^\s+$/u.test(grapheme)) pendingWhitespace ??= cell;
			else {
				appendWhitespace();
				pendingWhitespace = undefined;
				text += grapheme;
				for (let index = 0; index < grapheme.length; index += 1) cells.push(cell);
			}
			column += width;
		}
	}
	return { text, cells };
}

function sanitizePastedSearchData(data: string, initiallyPasting: boolean, initialBuffer: string) {
	let result = "";
	let offset = 0;
	let pasting = initiallyPasting;
	let buffer = initialBuffer;
	while (offset < data.length) {
		if (pasting) {
			const end = data.indexOf(PASTE_END, offset);
			if (end < 0) return { data: result, pasting, buffer: buffer + data.slice(offset) };
			result += sanitizeSearchQuery(buffer + data.slice(offset, end)) + PASTE_END;
			buffer = "";
			offset = end + PASTE_END.length;
			pasting = false;
			continue;
		}
		const start = data.indexOf(PASTE_START, offset);
		if (start < 0) return { data: result + data.slice(offset), pasting, buffer };
		result += data.slice(offset, start) + PASTE_START;
		offset = start + PASTE_START.length;
		pasting = true;
	}
	return { data: result, pasting, buffer };
}

function sanitizeSearchQuery(value: string) {
	return sanitizeTerminalDocument(value).replace(/\s+/gu, " ");
}

function normalizeQuery(value: string) {
	return sanitizeSearchQuery(value).trim();
}

function findMatchOffsets(corpus: string, query: string) {
	const expression = new RegExp(escapeRegExp(query), "giu");
	const offsets: number[] = [];
	for (const match of corpus.matchAll(expression)) {
		offsets.push(match.index, match.index + match[0].length);
	}
	return Uint32Array.from(offsets);
}

function findMatches(
	corpus: string,
	cells: readonly (CorpusCell | undefined)[],
	query: string,
): DocumentMatch[] {
	const offsets = findMatchOffsets(corpus, query);
	const matches: DocumentMatch[] = [];
	for (let index = 0; index < offsets.length; index += 2) {
		matches.push(materializeMatch(cells, offsets[index] ?? 0, offsets[index + 1] ?? 0));
	}
	return matches;
}

function materializeMatch(
	cells: readonly (CorpusCell | undefined)[],
	start: number,
	end: number,
): DocumentMatch {
	const byRow = new Map<number, CellRange>();
	for (let index = start; index < end; index += 1) {
		const cell = cells[index];
		if (!cell || cell.end <= cell.start) continue;
		const range = byRow.get(cell.row);
		if (range) {
			range.start = Math.min(range.start, cell.start);
			range.end = Math.max(range.end, cell.end);
		} else byRow.set(cell.row, { ...cell });
	}
	return { ranges: [...byRow.values()] };
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

function sameSearchSources(
	left: readonly DocumentSearchSource[],
	right: readonly DocumentSearchSource[],
) {
	return (
		left.length === right.length &&
		left.every(
			(source, sourceIndex) =>
				source.length === right[sourceIndex]?.length &&
				source.every((segment, segmentIndex) => {
					const other = right[sourceIndex]?.[segmentIndex];
					return (
						other !== undefined &&
						segment.row === other.row &&
						segment.column === other.column &&
						segment.text === other.text &&
						segment.separatorBefore === other.separatorBefore
					);
				}),
		)
	);
}

function uniqueMatches(matches: readonly DocumentMatch[]) {
	const seen = new Set<string>();
	return matches.filter((match) => {
		const first = match.ranges[0];
		const last = match.ranges.at(-1);
		const identity = `${first?.row}:${first?.start}-${last?.row}:${last?.end}`;
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
}

function sortMatches(matches: DocumentMatch[]) {
	return matches.sort((left, right) => {
		const leftStart = left.ranges[0];
		const rightStart = right.ranges[0];
		return (
			(leftStart?.row ?? 0) - (rightStart?.row ?? 0) ||
			(leftStart?.start ?? 0) - (rightStart?.start ?? 0)
		);
	});
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
