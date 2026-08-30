import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import * as PiTui from "@earendil-works/pi-tui";
import { hardWrapTerminalDocument } from "../terminal-document.js";
import type { ReviewFormat } from "../types.js";
import { sanitizeDocumentText } from "./document-sanitization.js";
import { mermaidMarkdownTransform, supportsRichMarkdown } from "./mermaid.js";
import { getLanguageFromPath, highlightCode } from "./syntax-highlighting.js";

export const RPC_DOCUMENT_LINE_WIDTH = 120;
export const RPC_DOCUMENT_PAGE_SIZE = 8;

type DocumentTheme = Pick<Theme, "fg" | "bold"> &
	Partial<Pick<Theme, "italic" | "underline" | "strikethrough">>;

export function createDocumentLineCache(theme: DocumentTheme) {
	let cached:
		| {
				content: string;
				formatKind: ReviewFormat["kind"];
				language: string | undefined;
				filePath: string | undefined;
				renderLatex: boolean | undefined;
				renderMermaid: boolean | undefined;
				richMarkdown: boolean;
				width: number;
				presentation: DocumentPresentation;
		  }
		| undefined;
	const presentation = (content: string, format: ReviewFormat | undefined, width: number) => {
		const identity = documentFormatIdentity(format);
		if (
			cached?.content === content &&
			cached.formatKind === identity.kind &&
			cached.language === identity.language &&
			cached.filePath === identity.filePath &&
			cached.renderLatex === identity.renderLatex &&
			cached.renderMermaid === identity.renderMermaid &&
			cached.richMarkdown === identity.richMarkdown &&
			cached.width === width
		) {
			return cached.presentation;
		}
		const next = formatDocumentPresentation(content, format, width, theme);
		cached = {
			content,
			formatKind: identity.kind,
			language: identity.language,
			filePath: identity.filePath,
			renderLatex: identity.renderLatex,
			renderMermaid: identity.renderMermaid,
			richMarkdown: identity.richMarkdown,
			width,
			presentation: next,
		};
		return next;
	};
	return {
		presentation,
		lines(content: string, format: ReviewFormat | undefined, width: number) {
			return presentation(content, format, width).lines;
		},
		invalidate() {
			cached = undefined;
		},
	};
}

export interface DocumentPresentation {
	lines: string[];
	/** Unpadded rows used to build the search corpus while retaining display-cell coordinates. */
	searchLines: string[];
	/** True when a rendered row continues directly into the next row without source whitespace. */
	softWrapAfter: boolean[];
	/** Ignore renderer-added indentation at the start of a continued row. */
	ignoreLeadingWhitespace: boolean[];
}

export function formatDocumentLines(
	content: string,
	format: ReviewFormat | undefined,
	width: number,
	theme: DocumentTheme,
): string[] {
	return formatDocumentPresentation(content, format, width, theme).lines;
}

export function formatDocumentPresentation(
	content: string,
	format: ReviewFormat | undefined,
	width: number,
	theme: DocumentTheme,
): DocumentPresentation {
	const resolvedFormat = format ?? { kind: "text" as const };
	if (resolvedFormat.kind === "markdown") {
		const lines = renderMarkdownDocument(content, resolvedFormat, width, theme);
		const searchLines = lines.map(markdownSearchLine);
		const referenceLines = renderMarkdownDocument(
			content,
			resolvedFormat,
			markdownReferenceWidth(content, width),
			theme,
		).map(markdownSearchLine);
		const softWrapAfter = markdownSoftWrapAfter(searchLines, referenceLines);
		return {
			lines,
			searchLines,
			softWrapAfter,
			ignoreLeadingWhitespace: searchLines.map((_, index) => softWrapAfter[index - 1] ?? false),
		};
	}
	const segments = documentSegments(content, width);
	let lines: string[];
	if (resolvedFormat.kind === "code") {
		const language =
			resolvedFormat.language ??
			(resolvedFormat.filePath ? getLanguageFromPath(resolvedFormat.filePath) : undefined);
		lines = segments.map(({ text }) => highlightCode(text, language, theme));
	} else if (resolvedFormat.kind === "diff") {
		lines = segments.map(({ source, text }) => {
			if (source.startsWith("@@")) return theme.fg("accent", text);
			if (source.startsWith("+") && !source.startsWith("+++")) {
				return theme.fg("toolDiffAdded", text);
			}
			if (source.startsWith("-") && !source.startsWith("---")) {
				return theme.fg("toolDiffRemoved", text);
			}
			return theme.fg("toolDiffContext", text);
		});
	} else {
		lines = segments.map(({ text }) => theme.fg("text", text));
	}
	return {
		lines,
		searchLines: lines,
		softWrapAfter: segments.map(({ softWrapAfter }) => softWrapAfter),
		ignoreLeadingWhitespace: lines.map(() => false),
	};
}

function markdownSearchLine(line: string) {
	const plain = PiTui.stripTerminalSequences(line).trimEnd();
	return plain.replace(/^(?:│ )+/u, (prefix) => " ".repeat(PiTui.visibleWidth(prefix)));
}

function markdownReferenceWidth(content: string, width: number) {
	const widestSourceLine = sanitizeDocumentText(content)
		.split("\n")
		.reduce((widest, line) => Math.max(widest, PiTui.visibleWidth(line)), 0);
	return Math.max(1, width, widestSourceLine + 32);
}

function markdownSoftWrapAfter(lines: readonly string[], referenceLines: readonly string[]) {
	const reference = referenceLines.map((line) => line.trim()).join("\n");
	let referenceOffset = 0;
	return lines.map((line, index) => {
		const next = lines[index + 1];
		if (next === undefined) return false;
		const left = Array.from(line.trim()).slice(-16).join("");
		const right = Array.from(next.trim()).slice(0, 16).join("");
		if (!left || !right) return false;
		const leftIndex = reference.indexOf(left, referenceOffset);
		if (leftIndex < 0) return false;
		referenceOffset = leftIndex + left.length;
		return reference.startsWith(right, referenceOffset);
	});
}

export function plainDocumentLines(content: string, width: number): string[] {
	return documentSegments(content, width).map(({ text }) => text);
}

function renderMarkdownDocument(
	content: string,
	format: Extract<ReviewFormat, { kind: "markdown" }>,
	width: number,
	theme: DocumentTheme,
): string[] {
	const component = new PiTui.Markdown(
		sanitizeDocumentText(content),
		0,
		0,
		markdownTheme(theme),
		{ color: (text) => theme.fg("text", text) },
		{
			renderLatex: format.renderLatex ?? true,
			transform: format.renderMermaid === false ? undefined : mermaidMarkdownTransform(theme),
		},
	);
	return component.render(Math.max(1, width));
}

function markdownTheme(theme: DocumentTheme): MarkdownTheme {
	return {
		heading: (text) => theme.fg("mdHeading", text),
		link: (text) => theme.fg("mdLink", text),
		linkUrl: (text) => theme.fg("mdLinkUrl", text),
		code: (text) => theme.fg("mdCode", text),
		codeBlock: (text) => theme.fg("mdCodeBlock", text),
		codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
		quote: (text) => theme.fg("mdQuote", text),
		quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
		hr: (text) => theme.fg("mdHr", text),
		listBullet: (text) => theme.fg("mdListBullet", text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic?.(text) ?? text,
		underline: (text) => theme.underline?.(text) ?? text,
		strikethrough: (text) => theme.strikethrough?.(text) ?? text,
		highlightCode: (code, language) =>
			code.split("\n").map((line) => highlightCode(line, language, theme)),
	};
}

export function documentDialogPages(content: string, width: number, pageSize: number): string[][] {
	const lines = plainDocumentLines(content, width);
	const safePageSize = Math.max(1, Math.floor(pageSize));
	const pages: string[][] = [];
	for (let index = 0; index < lines.length; index += safePageSize) {
		pages.push(lines.slice(index, index + safePageSize));
	}
	return pages.length > 0 ? pages : [[""]];
}

function documentFormatIdentity(format: ReviewFormat | undefined) {
	const shared = {
		renderLatex: undefined,
		renderMermaid: undefined,
		richMarkdown: supportsRichMarkdown(),
	};
	if (format?.kind === "code") {
		return { ...shared, kind: format.kind, language: format.language, filePath: format.filePath };
	}
	if (format?.kind === "diff") {
		return { ...shared, kind: format.kind, language: undefined, filePath: format.filePath };
	}
	if (format?.kind === "markdown") {
		return {
			...shared,
			kind: format.kind,
			language: undefined,
			filePath: undefined,
			renderLatex: format.renderLatex ?? true,
			renderMermaid: format.renderMermaid ?? true,
		};
	}
	return { ...shared, kind: "text" as const, language: undefined, filePath: undefined };
}

function documentSegments(content: string, width: number) {
	return sanitizeDocumentText(content)
		.split("\n")
		.flatMap((source) => {
			const wrapped = hardWrapTerminalDocument(source, width);
			return wrapped.map((text, index) => ({
				source,
				text,
				softWrapAfter: index < wrapped.length - 1,
			}));
		});
}
