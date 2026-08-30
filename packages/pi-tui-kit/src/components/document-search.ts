import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
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
const MAX_SEARCH_QUERY_LENGTH = 4_096;
const MAX_PASTE_BUFFER_LENGTH = MAX_SEARCH_QUERY_LENGTH * 16;
export const DOCUMENT_SEARCH_ACTIVATE_KEY = "/";

type SearchTheme = Pick<Theme, "bold" | "fg"> &
	Partial<Pick<Theme, "bg" | "inverse" | "underline">>;

interface CellRange {
	row: number;
	start: number;
	end: number;
}

interface DocumentMatch {
	ranges: CellRange[];
}

interface CorpusCells {
	rows: Uint32Array;
	starts: Uint32Array;
	ends: Uint32Array;
}

const INVALID_CELL = 0xffffffff;

class CorpusCellBuilder {
	private rows: Uint32Array;
	private starts: Uint32Array;
	private ends: Uint32Array;
	private length = 0;

	constructor(initialCapacity = 1_024) {
		const capacity = Math.max(1, initialCapacity);
		this.rows = new Uint32Array(capacity);
		this.starts = new Uint32Array(capacity);
		this.ends = new Uint32Array(capacity);
	}

	push(row: number, start: number, end: number) {
		this.ensureCapacity();
		this.rows[this.length] = row;
		this.starts[this.length] = start;
		this.ends[this.length] = end;
		this.length += 1;
	}

	finish(): CorpusCells {
		if (this.length === this.rows.length) {
			return { rows: this.rows, starts: this.starts, ends: this.ends };
		}
		return {
			rows: this.rows.slice(0, this.length),
			starts: this.starts.slice(0, this.length),
			ends: this.ends.slice(0, this.length),
		};
	}

	private ensureCapacity() {
		if (this.length < this.rows.length) return;
		const capacity = this.rows.length * 2;
		const rows = new Uint32Array(capacity);
		const starts = new Uint32Array(capacity);
		const ends = new Uint32Array(capacity);
		rows.set(this.rows);
		starts.set(this.starts);
		ends.set(this.ends);
		this.rows = rows;
		this.starts = starts;
		this.ends = ends;
	}
}

class MatchOffsetBuilder {
	private offsets: Uint32Array;
	private length = 0;

	constructor(initialCapacity = 1_024) {
		this.offsets = new Uint32Array(Math.max(2, initialCapacity));
	}

	push(start: number, end: number) {
		if (this.length + 2 > this.offsets.length) {
			const offsets = new Uint32Array(this.offsets.length * 2);
			offsets.set(this.offsets);
			this.offsets = offsets;
		}
		this.offsets[this.length] = start;
		this.offsets[this.length + 1] = end;
		this.length += 2;
	}

	finish() {
		return this.length === this.offsets.length ? this.offsets : this.offsets.slice(0, this.length);
	}
}

function emptyCorpusCells(): CorpusCells {
	return {
		rows: new Uint32Array(),
		starts: new Uint32Array(),
		ends: new Uint32Array(),
	};
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
	private cells = emptyCorpusCells();
	private corpusReady = false;
	private matches: DocumentMatch[] = [];
	private compactMatchOffsets: Uint32Array | undefined;
	private alternateGlobalIndexes: number[] = [];
	private currentIndex = 0;
	private pasting = false;
	private pasteBuffer = "";
	private pasteStartBuffer = "";
	private anchorRow = 0;

	get focused() {
		return this.parentFocused;
	}

	set focused(value: boolean) {
		this.parentFocused = value;
		this.syncFocus();
	}

	get count() {
		return (this.compactMatchOffsets?.length ?? 0) / 2 + this.matches.length;
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
		anchorRow = 0,
	) {
		this.active = true;
		this.anchorRow = Math.max(0, anchorRow);
		this.updateLines(lines, softWrapAfter, ignoreLeadingWhitespace, searchSources);
		this.ensureCorpus();
		this.syncFocus();
	}

	close() {
		this.active = false;
		this.input.setValue("");
		this.releaseCorpus();
		this.currentIndex = 0;
		this.anchorRow = 0;
		this.pasting = false;
		this.pasteBuffer = "";
		this.pasteStartBuffer = "";
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
			return false;
		}
		this.lines = [...lines];
		this.softWrapAfter = [...softWrapAfter];
		this.ignoreLeadingWhitespace = [...ignoreLeadingWhitespace];
		this.searchSources = searchSources.map((source) => source.map((segment) => ({ ...segment })));
		this.anchorRow = this.currentRow ?? this.anchorRow;
		this.releaseCorpus();
		if (this.active) this.ensureCorpus();
		return true;
	}

	routeInput(data: string, handleOutsidePaste: (data: string) => boolean) {
		let changed = false;
		const input = this.pasteStartBuffer + data;
		this.pasteStartBuffer = "";
		let offset = 0;
		while (offset < input.length) {
			if (this.pasting) {
				const markerPrefix = this.pasteBuffer.slice(-(PASTE_END.length - 1));
				const combined = markerPrefix + input.slice(offset);
				const end = combined.indexOf(PASTE_END);
				const consumed =
					end < 0
						? input.length - offset
						: Math.max(0, end + PASTE_END.length - markerPrefix.length);
				const nextOffset = offset + consumed;
				changed = this.handleInput(input.slice(offset, nextOffset)) || changed;
				offset = nextOffset;
				continue;
			}
			const start = input.indexOf(PASTE_START, offset);
			if (start < 0) {
				const remainder = input.slice(offset);
				const prefixLength = trailingMarkerPrefixLength(remainder, PASTE_START);
				const outsidePaste = remainder.slice(0, remainder.length - prefixLength);
				if (outsidePaste && !handleOutsidePaste(outsidePaste)) {
					return { changed, stopped: true };
				}
				this.pasteStartBuffer = remainder.slice(remainder.length - prefixLength);
				return { changed, stopped: false };
			}
			if (start > offset && !handleOutsidePaste(input.slice(offset, start))) {
				return { changed, stopped: true };
			}
			if (!this.active) return { changed, stopped: true };
			const end = input.indexOf(PASTE_END, start + PASTE_START.length);
			const nextOffset = end < 0 ? input.length : end + PASTE_END.length;
			changed = this.handleInput(input.slice(start, nextOffset)) || changed;
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
		if (this.input.getValue() === previous) return false;
		this.rebuildMatches();
		return true;
	}

	next() {
		if (this.count > 0) this.currentIndex = (this.currentIndex + 1) % this.count;
		this.anchorRow = this.currentRow ?? this.anchorRow;
		return this.currentRow;
	}

	previous() {
		if (this.count > 0) {
			this.currentIndex = (this.currentIndex - 1 + this.count) % this.count;
		}
		this.anchorRow = this.currentRow ?? this.anchorRow;
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
		this.releaseCorpus();
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

	private ensureCorpus() {
		if (this.corpusReady) return;
		const corpus = buildCorpus(this.lines, this.softWrapAfter, this.ignoreLeadingWhitespace);
		this.corpus = corpus.text;
		this.cells = corpus.cells;
		this.corpusReady = true;
		this.rebuildMatches();
	}

	private releaseCorpus() {
		this.corpus = "";
		this.cells = emptyCorpusCells();
		this.corpusReady = false;
		this.matches = [];
		this.compactMatchOffsets = undefined;
		this.alternateGlobalIndexes = [];
	}

	private rebuildMatches() {
		if (!this.corpusReady) {
			this.ensureCorpus();
			return;
		}
		this.anchorRow = this.currentRow ?? this.anchorRow;
		const query = normalizeQuery(this.input.getValue());
		this.compactMatchOffsets = undefined;
		this.matches = [];
		this.alternateGlobalIndexes = [];
		if (query) {
			this.compactMatchOffsets = findMatchOffsets(this.corpus, query);
			const alternates = sortMatches(
				uniqueMatches(
					this.searchSources.flatMap((source) =>
						findAlternateMatches(buildSearchSourceCorpus(source), query),
					),
				),
			);
			this.matches = alternates.filter((match) => !this.hasPrimaryMatch(match));
			this.alternateGlobalIndexes = this.matches.map(
				(match, index) => this.primaryInsertionIndex(match) + index,
			);
		}
		this.currentIndex = this.matchIndexAtOrAfter(this.anchorRow);
		this.anchorRow = this.currentRow ?? this.anchorRow;
	}

	private matchIndexAtOrAfter(row: number) {
		let low = 0;
		let high = this.count;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			const middleRow = this.matchAt(middle)?.ranges[0]?.row ?? Number.POSITIVE_INFINITY;
			if (middleRow < row) low = middle + 1;
			else high = middle;
		}
		return low < this.count ? low : 0;
	}

	private primaryMatch(index: number) {
		if (!this.compactMatchOffsets || index < 0 || index >= this.compactMatchOffsets.length / 2) {
			return undefined;
		}
		const offsetIndex = index * 2;
		return materializeMatch(
			this.cells,
			this.compactMatchOffsets[offsetIndex] ?? 0,
			this.compactMatchOffsets[offsetIndex + 1] ?? 0,
		);
	}

	private primaryInsertionIndex(match: DocumentMatch) {
		let low = 0;
		let high = (this.compactMatchOffsets?.length ?? 0) / 2;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			const candidate = this.primaryMatch(middle);
			if (candidate && compareMatchStarts(candidate, match) < 0) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	private hasPrimaryMatch(match: DocumentMatch) {
		const insertion = this.primaryInsertionIndex(match);
		return [this.primaryMatch(insertion - 1), this.primaryMatch(insertion)].some(
			(candidate) => candidate !== undefined && matchIdentity(candidate) === matchIdentity(match),
		);
	}

	private currentMatch() {
		return this.matchAt(this.currentIndex);
	}

	private matchAt(index: number) {
		const alternateIndex = lowerBound(this.alternateGlobalIndexes, index);
		if (this.alternateGlobalIndexes[alternateIndex] === index) {
			return this.matches[alternateIndex];
		}
		return this.primaryMatch(index - alternateIndex);
	}

	private highlightMatches(): Array<[number, DocumentMatch]> {
		if (this.count > MAX_HIGHLIGHTED_MATCHES) {
			const current = this.currentMatch();
			return current ? [[this.currentIndex, current]] : [];
		}
		const matches: Array<[number, DocumentMatch]> = [];
		for (let index = 0; index < this.count; index += 1) {
			const match = this.matchAt(index);
			if (match) matches.push([index, match]);
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
	const estimatedCells =
		lines.reduce((total, line) => total + line.length, 0) + Math.max(0, lines.length - 1);
	const cells = new CorpusCellBuilder(estimatedCells);
	let pendingRow = INVALID_CELL;
	let pendingStart = 0;
	let pendingEnd = 0;
	const setPendingWhitespace = (row: number, start: number, end: number) => {
		if (pendingRow !== INVALID_CELL) return;
		pendingRow = row;
		pendingStart = start;
		pendingEnd = end;
	};
	const appendWhitespace = () => {
		if (pendingRow === INVALID_CELL || text.endsWith(" ") || text.length === 0) return;
		text += " ";
		cells.push(pendingRow, pendingStart, pendingEnd);
	};
	const clearPendingWhitespace = () => {
		pendingRow = INVALID_CELL;
	};
	for (const [row, line] of lines.entries()) {
		let column = 0;
		let hasContent = false;
		const appendSegment = (segment: string, width: number) => {
			const start = column;
			const end = column + width;
			if (/^\s+$/u.test(segment)) {
				if (hasContent || !ignoreLeadingWhitespace[row]) setPendingWhitespace(row, start, end);
			} else {
				appendWhitespace();
				clearPendingWhitespace();
				hasContent = true;
				text += segment;
				for (let index = 0; index < segment.length; index += 1) cells.push(row, start, end);
			}
			column = end;
		};
		const plain = stripTerminalSequences(line);
		if (/^[\x20-\x7e]*$/u.test(plain)) {
			let index = 0;
			while (index < plain.length) {
				if (plain[index] === " ") {
					if (hasContent || !ignoreLeadingWhitespace[row]) {
						setPendingWhitespace(row, column, column + 1);
					}
					while (plain[index] === " ") {
						index += 1;
						column += 1;
					}
					continue;
				}
				const start = index;
				while (index < plain.length && plain[index] !== " ") index += 1;
				appendWhitespace();
				clearPendingWhitespace();
				hasContent = true;
				const run = plain.slice(start, index);
				text += run;
				for (let offset = 0; offset < run.length; offset += 1) {
					cells.push(row, column + offset, column + offset + 1);
				}
				column += run.length;
			}
		} else {
			for (const { segment } of graphemeSegmenter.segment(plain)) {
				appendSegment(segment, visibleWidth(segment));
			}
		}
		if (!softWrapAfter[row]) setPendingWhitespace(row, column, column);
	}
	return { text, cells: cells.finish() };
}

function buildSearchSourceCorpus(source: DocumentSearchSource) {
	let text = "";
	const estimatedCells =
		source.reduce((total, segment) => total + segment.text.length, 0) +
		Math.max(0, source.length - 1);
	const cells = new CorpusCellBuilder(estimatedCells);
	const boundaries: number[] = [];
	let pendingRow = INVALID_CELL;
	let pendingStart = 0;
	let pendingEnd = 0;
	const setPendingWhitespace = (row: number, start: number, end: number) => {
		if (pendingRow !== INVALID_CELL) return;
		pendingRow = row;
		pendingStart = start;
		pendingEnd = end;
	};
	const appendWhitespace = () => {
		if (pendingRow === INVALID_CELL || text.endsWith(" ") || text.length === 0) return;
		text += " ";
		cells.push(pendingRow, pendingStart, pendingEnd);
	};
	for (const [segmentIndex, segment] of source.entries()) {
		if (segmentIndex > 0) boundaries.push(text.length);
		let column = segment.column;
		if (segment.separatorBefore) setPendingWhitespace(segment.row, column, column);
		for (const { segment: grapheme } of graphemeSegmenter.segment(segment.text)) {
			const width = visibleWidth(grapheme);
			const start = column;
			const end = column + width;
			if (/^\s+$/u.test(grapheme)) setPendingWhitespace(segment.row, start, end);
			else {
				appendWhitespace();
				pendingRow = INVALID_CELL;
				text += grapheme;
				for (let index = 0; index < grapheme.length; index += 1) {
					cells.push(segment.row, start, end);
				}
			}
			column = end;
		}
	}
	return { text, cells: cells.finish(), boundaries };
}

function sanitizePastedSearchData(data: string, initiallyPasting: boolean, initialBuffer: string) {
	let result = "";
	let offset = 0;
	let pasting = initiallyPasting;
	let buffer = initialBuffer;
	while (offset < data.length) {
		if (pasting) {
			const combined = buffer + data.slice(offset);
			const end = combined.indexOf(PASTE_END);
			if (end < 0) {
				return { data: result, pasting, buffer: appendPasteBuffer(buffer, data.slice(offset)) };
			}
			result += sanitizeSearchQuery(combined.slice(0, end)) + PASTE_END;
			const consumed = Math.max(0, end + PASTE_END.length - buffer.length);
			buffer = "";
			offset += consumed;
			pasting = false;
			continue;
		}
		const start = data.indexOf(PASTE_START, offset);
		if (start < 0) {
			return {
				data: result + sanitizeUnbracketedSearchData(data.slice(offset)),
				pasting,
				buffer,
			};
		}
		result += sanitizeUnbracketedSearchData(data.slice(offset, start)) + PASTE_START;
		offset = start + PASTE_START.length;
		pasting = true;
	}
	return { data: result, pasting, buffer };
}

function appendPasteBuffer(buffer: string, value: string) {
	const combined = buffer + value;
	if (combined.length <= MAX_PASTE_BUFFER_LENGTH) return combined;
	const tailLength = PASTE_END.length - 1;
	return combined.slice(0, MAX_PASTE_BUFFER_LENGTH - tailLength) + combined.slice(-tailLength);
}

function trailingMarkerPrefixLength(value: string, marker: string) {
	for (let length = Math.min(value.length, marker.length - 1); length > 0; length -= 1) {
		if (marker.startsWith(value.slice(-length))) return length;
	}
	return 0;
}

function sanitizeUnbracketedSearchData(value: string) {
	const kittyPrintable = decodeKittyPrintable(value);
	if (kittyPrintable !== undefined) return sanitizeTerminalDocument(kittyPrintable);
	const hasTerminalControl = Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
	});
	return hasTerminalControl ? value : sanitizeTerminalDocument(value);
}

function sanitizeSearchQuery(value: string) {
	return sanitizeTerminalDocument(value).replace(/\s+/gu, " ").slice(0, MAX_SEARCH_QUERY_LENGTH);
}

function normalizeQuery(value: string) {
	return sanitizeSearchQuery(value).trim();
}

function findMatchOffsets(corpus: string, query: string) {
	if (query.length > corpus.length) return new Uint32Array();
	const maximumOffsetCount = Math.floor(corpus.length / query.length) * 2;
	const offsets = new MatchOffsetBuilder(maximumOffsetCount);
	if (/^[\x20-\x7e]+$/u.test(query) && /^[\x20-\x7e]*$/u.test(corpus)) {
		const haystack = corpus.toLowerCase();
		const needle = query.toLowerCase();
		let offset = 0;
		while (offset <= haystack.length - needle.length) {
			const match = haystack.indexOf(needle, offset);
			if (match < 0) break;
			offsets.push(match, match + needle.length);
			offset = match + needle.length;
		}
		return offsets.finish();
	}
	const expression = new RegExp(escapeRegExp(query), "giu");
	for (const match of corpus.matchAll(expression)) {
		offsets.push(match.index, match.index + match[0].length);
	}
	return offsets.finish();
}

function findAlternateMatches(
	corpus: ReturnType<typeof buildSearchSourceCorpus>,
	query: string,
): DocumentMatch[] {
	const offsets = findMatchOffsets(corpus.text, query);
	const matches: DocumentMatch[] = [];
	for (let index = 0; index < offsets.length; index += 2) {
		const start = offsets[index] ?? 0;
		const end = offsets[index + 1] ?? 0;
		const boundaryIndex = lowerBound(corpus.boundaries, start + 1);
		if ((corpus.boundaries[boundaryIndex] ?? Number.POSITIVE_INFINITY) >= end) continue;
		matches.push(materializeMatch(corpus.cells, start, end));
	}
	return matches;
}

function materializeMatch(cells: CorpusCells, start: number, end: number): DocumentMatch {
	const byRow = new Map<number, CellRange>();
	for (let index = start; index < end; index += 1) {
		const row = cells.rows[index] ?? INVALID_CELL;
		const cellStart = cells.starts[index] ?? 0;
		const cellEnd = cells.ends[index] ?? 0;
		if (row === INVALID_CELL || cellEnd <= cellStart) continue;
		const range = byRow.get(row);
		if (range) {
			range.start = Math.min(range.start, cellStart);
			range.end = Math.max(range.end, cellEnd);
		} else byRow.set(row, { row, start: cellStart, end: cellEnd });
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
		if (range.current) target = theme.bold(theme.inverse?.(target) ?? target);
		else target = theme.underline?.(target) ?? target;
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
		const identity = matchIdentity(match);
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
}

function matchIdentity(match: DocumentMatch) {
	const first = match.ranges[0];
	const last = match.ranges.at(-1);
	return `${first?.row}:${first?.start}-${last?.row}:${last?.end}`;
}

function compareMatchStarts(left: DocumentMatch, right: DocumentMatch) {
	const leftStart = left.ranges[0];
	const rightStart = right.ranges[0];
	return (
		(leftStart?.row ?? 0) - (rightStart?.row ?? 0) ||
		(leftStart?.start ?? 0) - (rightStart?.start ?? 0)
	);
}

function sortMatches(matches: DocumentMatch[]) {
	return matches.sort(compareMatchStarts);
}

function lowerBound(values: readonly number[], target: number) {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if ((values[middle] ?? 0) < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
