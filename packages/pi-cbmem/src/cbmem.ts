import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";
import { renderCodebaseMemoryResult } from "./render-result.js";
import { type BridgeToolDefinition, TOOL_DEFINITIONS, type ToolName } from "./tool-definitions.js";
import {
	BORROWABLE_TOOL_NAMES,
	CURRENT_PROJECT_ALIAS,
	currentRelativePath,
	defaultProjectResolutionService,
	type ProjectResolution,
	type ProjectResolutionService,
} from "./worktree-project.js";

export { TOOL_NAMES } from "./tool-definitions.js";

const BIN = join(homedir(), ".local", "bin", "codebase-memory-mcp");
const STDERR_MAX_BYTES = 8 * 1024;
const FORCE_KILL_DELAY_MS = 250;

export interface CbmemToolDetails {
	truncated: boolean;
	totalBytes: number;
	totalLines: number;
	projectResolution?: ProjectResolution;
}

class BoundedPrefixCollector {
	readonly maxBytes: number;
	text = "";
	totalBytes = 0;
	newlines = 0;
	endsWithNewline = false;
	truncated = false;

	constructor(maxBytes: number) {
		this.maxBytes = maxBytes;
	}

	append(chunk: string): void {
		const chunkBytes = Buffer.byteLength(chunk, "utf8");
		this.totalBytes += chunkBytes;
		this.newlines += countOccurrences(chunk, "\n");
		if (chunk.length > 0) this.endsWithNewline = chunk.endsWith("\n");

		const remaining = this.maxBytes - Buffer.byteLength(this.text, "utf8");
		if (remaining <= 0) {
			if (chunkBytes > 0) this.truncated = true;
			return;
		}
		const kept = takeUtf8Prefix(chunk, remaining, Number.POSITIVE_INFINITY);
		this.text += kept;
		if (kept.length !== chunk.length) this.truncated = true;
	}

	get totalLines(): number {
		if (this.totalBytes === 0) return 0;
		return this.newlines + (this.endsWithNewline ? 0 : 1);
	}
}

class BoundedTailCollector {
	readonly maxBytes: number;
	text = "";
	truncated = false;

	constructor(maxBytes: number) {
		this.maxBytes = maxBytes;
	}

	append(chunk: string): void {
		this.text += chunk;
		if (Buffer.byteLength(this.text, "utf8") <= this.maxBytes) return;
		this.text = takeUtf8Suffix(this.text, this.maxBytes);
		this.truncated = true;
	}
}

export async function callCodebaseMemory(
	tool: ToolName,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
	cwd: string,
	binary = BIN,
): Promise<AgentToolResult<CbmemToolDetails>> {
	signal?.throwIfAborted();
	const input = JSON.stringify(args);

	return await new Promise((resolve, reject) => {
		const stdout = new BoundedPrefixCollector(DEFAULT_MAX_BYTES);
		const stderr = new BoundedTailCollector(STDERR_MAX_BYTES);
		const child = spawn(binary, ["cli", tool], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, CBM_LOG_LEVEL: "error" },
		});
		let settled = false;
		let forceKillTimer: NodeJS.Timeout | undefined;

		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
			if (forceKillTimer) clearTimeout(forceKillTimer);
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			reject(error);
		};
		const succeed = (result: AgentToolResult<CbmemToolDetails>) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};
		const onAbort = () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.kill("SIGTERM");
			forceKillTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, FORCE_KILL_DELAY_MS);
			forceKillTimer.unref();
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => stdout.append(chunk));
		child.stderr.on("data", (chunk: string) => stderr.append(chunk));
		child.stdout.on("error", fail);
		child.stderr.on("error", fail);
		child.stdin.on("error", () => {
			// Spawn and exit errors are reported by the child process events below.
		});
		child.on("error", fail);
		child.on("close", (code) => {
			if (settled) return;
			if (signal?.aborted) {
				fail(abortReason(signal));
				return;
			}
			if (code !== 0) {
				fail(cliFailure(tool, code, stderr));
				return;
			}
			if (stdout.truncated) {
				fail(
					new Error(
						`codebase-memory-mcp ${tool} exceeded ${formatSize(DEFAULT_MAX_BYTES)} before a complete JSON response could be validated`,
					),
				);
				return;
			}

			try {
				const response = extractLastJson(stdout.text);
				const bounded = boundOutput(response, stdout);
				succeed({
					content: [{ type: "text", text: bounded.text }],
					details: {
						truncated: bounded.truncated,
						totalBytes: stdout.totalBytes,
						totalLines: stdout.totalLines,
					},
				});
			} catch (error) {
				const diagnostic = stderr.text.trim();
				const suffix = diagnostic ? `: ${diagnostic}` : "";
				fail(
					new Error(`codebase-memory-mcp ${tool} returned no JSON response${suffix}`, {
						cause: error,
					}),
				);
			}
		});
		child.stdin.end(input);
	});
}

export default function cbmem(
	pi: ExtensionAPI,
	binary = BIN,
	projectResolutionService = defaultProjectResolutionService,
): void {
	for (const definition of TOOL_DEFINITIONS) {
		registerBridgeTool(pi, definition, binary, projectResolutionService);
	}
}

function registerBridgeTool(
	pi: ExtensionAPI,
	definition: BridgeToolDefinition,
	binary: string,
	projectResolutionService: ProjectResolutionService,
): void {
	pi.registerTool({
		...definition,
		renderResult: renderCodebaseMemoryResult,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const tool = definition.name as ToolName;
			let args = params as Record<string, unknown>;
			let resolution: ProjectResolution | undefined;
			const query = async (
				queryTool: ToolName,
				queryArgs: Record<string, unknown>,
				querySignal: AbortSignal | undefined,
			): Promise<unknown> => {
				const result = await callCodebaseMemory(queryTool, queryArgs, querySignal, ctx.cwd, binary);
				querySignal?.throwIfAborted();
				return parseJsonResult(result, queryTool);
			};

			if (args.project === CURRENT_PROJECT_ALIAS) {
				if (!BORROWABLE_TOOL_NAMES.has(tool)) {
					throw new Error(
						`${CURRENT_PROJECT_ALIAS} is available only for read-only graph tools; specify an indexed project for ${tool}`,
					);
				}
				resolution = await projectResolutionService.resolve(ctx.cwd, signal, query);
				signal?.throwIfAborted();
				args = { ...args, project: resolution.project };
			}

			await confirmDestructiveCall(tool, args, signal, ctx);
			signal?.throwIfAborted();
			let result = await callCodebaseMemory(tool, args, signal, ctx.cwd, binary);
			signal?.throwIfAborted();
			if (!resolution) return result;
			if (resolution.kind === "borrowed" && tool === "get_code_snippet") {
				result = await rewriteBorrowedSnippet(result, resolution, signal);
				signal?.throwIfAborted();
			}
			await projectResolutionService.revalidate(resolution, signal, query);
			signal?.throwIfAborted();
			return attachProjectResolution(result, resolution);
		},
	});
}

function parseJsonResult(result: AgentToolResult<CbmemToolDetails>, tool: ToolName): unknown {
	const content = result.content[0];
	if (content?.type !== "text") {
		throw new Error(`codebase-memory-mcp ${tool} returned no text result`);
	}
	try {
		return JSON.parse(content.text);
	} catch (error) {
		throw new Error(`codebase-memory-mcp ${tool} returned invalid JSON`, { cause: error });
	}
}

async function rewriteBorrowedSnippet(
	result: AgentToolResult<CbmemToolDetails>,
	resolution: ProjectResolution,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<CbmemToolDetails>> {
	const snippet = parseJsonResult(result, "get_code_snippet");
	if (!snippet || typeof snippet !== "object" || Array.isArray(snippet)) {
		throw new Error("Codebase Memory returned an invalid borrowed code snippet");
	}
	const record = snippet as Record<string, unknown>;
	if (
		typeof record.file_path !== "string" ||
		typeof record.start_line !== "number" ||
		typeof record.end_line !== "number"
	) {
		throw new Error("Codebase Memory returned incomplete borrowed code snippet metadata");
	}
	const start = record.start_line;
	const end = record.end_line;
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
		throw new Error("Codebase Memory returned an invalid borrowed code snippet range");
	}
	if (end - start + 1 > DEFAULT_MAX_LINES) {
		throw new Error("The borrowed code snippet range exceeds Pi's line limit");
	}
	const currentPath = currentRelativePath(resolution, record.file_path);
	const file = await lstat(currentPath);
	signal?.throwIfAborted();
	if (!file.isFile() || file.isSymbolicLink()) {
		throw new Error("Borrowed code snippet does not resolve to a regular worktree file");
	}
	record.file_path = currentPath;
	record.source = await readLineRange(currentPath, start, end, signal);
	signal?.throwIfAborted();
	return replaceTextResult(result, JSON.stringify(record));
}

function attachProjectResolution(
	result: AgentToolResult<CbmemToolDetails>,
	resolution: ProjectResolution,
): AgentToolResult<CbmemToolDetails> {
	const content = result.content[0];
	if (content?.type !== "text") return result;
	const metadata = {
		kind: resolution.kind === "borrowed" ? "borrowed_canonical_base" : "current_index",
		project: resolution.project,
		current_root: resolution.currentRoot,
		source_root: resolution.sourceRoot,
		head_sha: resolution.headSha,
		read_only: resolution.kind === "borrowed",
	};
	let text: string;
	try {
		const parsed = JSON.parse(content.text);
		text = JSON.stringify(
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? { ...parsed, pi_cbmem_resolution: metadata }
				: { result: parsed, pi_cbmem_resolution: metadata },
		);
	} catch {
		text = `[pi-cbmem project resolution: ${JSON.stringify(metadata)}]\n${content.text}`;
	}
	const replaced = replaceTextResult(result, text);
	return {
		...replaced,
		details: { ...replaced.details, projectResolution: resolution },
	};
}

function replaceTextResult(
	result: AgentToolResult<CbmemToolDetails>,
	text: string,
): AgentToolResult<CbmemToolDetails> {
	const totalBytes = Buffer.byteLength(text, "utf8");
	const totalLines = countLines(text);
	if (totalBytes > DEFAULT_MAX_BYTES || totalLines > DEFAULT_MAX_LINES) {
		throw new Error(
			`pi-cbmem project-resolved output exceeded ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (${totalLines} lines, ${formatSize(totalBytes)}); refusing to return truncated structured data`,
		);
	}
	return {
		...result,
		content: [{ type: "text", text }],
		details: {
			...result.details,
			totalBytes,
			totalLines,
		},
	};
}

export async function readLineRange(
	path: string,
	startLine: number,
	endLine: number,
	signal: AbortSignal | undefined,
): Promise<string> {
	signal?.throwIfAborted();
	const stream = createReadStream(path, {
		encoding: "utf8",
		highWaterMark: 64 * 1024,
		signal,
	});
	let currentLine = 1;
	let completedLine = 0;
	let currentLineHasContent = false;
	let selected = "";
	let selectedBytes = 0;
	try {
		for await (const value of stream) {
			signal?.throwIfAborted();
			const chunk = String(value);
			let offset = 0;
			while (offset < chunk.length) {
				const newline = chunk.indexOf("\n", offset);
				const end = newline >= 0 ? newline + 1 : chunk.length;
				const segment = chunk.slice(offset, end);
				currentLineHasContent ||= segment.length > 0;
				if (currentLine >= startLine && currentLine <= endLine) {
					selectedBytes += Buffer.byteLength(segment, "utf8");
					if (selectedBytes > DEFAULT_MAX_BYTES) {
						throw new Error("The borrowed code snippet exceeds Pi's byte limit");
					}
					selected += segment;
				}
				if (newline >= 0) {
					completedLine = currentLine;
					if (currentLine === endLine) return selected;
					currentLine += 1;
					currentLineHasContent = false;
				}
				offset = end;
			}
		}
		signal?.throwIfAborted();
		if (currentLineHasContent) completedLine = currentLine;
		if (completedLine < endLine) {
			throw new Error("The borrowed code snippet range is outside the current worktree file");
		}
		return selected;
	} finally {
		stream.destroy();
	}
}

async function confirmDestructiveCall(
	tool: ToolName,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<void> {
	const prompt = destructivePrompt(tool, args);
	if (!prompt) return;

	signal?.throwIfAborted();
	if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
		throw new Error(
			`Codebase Memory ${tool} requires user confirmation in TUI or RPC mode before it can run.`,
		);
	}
	const confirmed = await ctx.ui.confirm(prompt.title, prompt.message, { signal });
	signal?.throwIfAborted();
	if (!confirmed) {
		throw new DOMException(`Codebase Memory ${tool} was cancelled by the user.`, "AbortError");
	}
}

function destructivePrompt(
	tool: ToolName,
	args: Record<string, unknown>,
): { title: string; message: string } | undefined {
	const project = safeArgument(args.project, "unknown project");
	if (tool === "delete_project") {
		return {
			title: "Delete Codebase Memory project?",
			message: `Project: ${project}\nThis permanently removes the project's Codebase Memory index.`,
		};
	}
	if (tool === "manage_adr" && args.mode === "update") {
		const contentBytes =
			typeof args.content === "string" ? Buffer.byteLength(args.content, "utf8") : 0;
		return {
			title: "Replace Codebase Memory ADRs?",
			message: `Project: ${project}\nReplace the complete ADR document with ${contentBytes} bytes of content.`,
		};
	}
	return undefined;
}

function safeArgument(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	return sanitizeTerminalText(value) || fallback;
}

function extractLastJson(output: string): string {
	const trimmed = output.trim();
	if (!trimmed) throw new Error("empty stdout");
	try {
		JSON.parse(trimmed);
		return trimmed;
	} catch {
		const lines = trimmed.split("\n");
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index].trim();
			if (!line) continue;
			try {
				JSON.parse(line);
				return line;
			} catch {
				// Keep scanning for the last complete JSON response.
			}
		}
		throw new Error("stdout did not contain JSON");
	}
}

function boundOutput(
	text: string,
	collector: BoundedPrefixCollector,
): { text: string; truncated: boolean } {
	const textBytes = Buffer.byteLength(text, "utf8");
	const textLines = countLines(text);
	const truncated =
		collector.truncated || textBytes > DEFAULT_MAX_BYTES || textLines > DEFAULT_MAX_LINES;
	if (!truncated) return { text, truncated: false };

	const notice = `[Output truncated: Codebase Memory produced ${collector.totalLines} lines (${formatSize(collector.totalBytes)}); additional output was omitted.]`;
	const separator = "\n";
	const body = takeUtf8Prefix(
		text,
		Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(notice + separator, "utf8")),
		Math.max(0, DEFAULT_MAX_LINES - 1),
	);
	return {
		text: body ? `${body}${body.endsWith("\n") ? "" : separator}${notice}` : notice,
		truncated: true,
	};
}

function cliFailure(tool: ToolName, code: number | null, stderr: BoundedTailCollector): Error {
	const diagnostic = stderr.text.trim();
	const truncation = stderr.truncated ? "[earlier stderr omitted] " : "";
	const suffix = diagnostic ? `: ${truncation}${diagnostic}` : "";
	return new Error(`codebase-memory-mcp ${tool} exited with code ${code ?? "unknown"}${suffix}`);
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException("Codebase Memory tool call was aborted", "AbortError");
}

function takeUtf8Prefix(text: string, maxBytes: number, maxLines: number): string {
	let bytes = 0;
	let lines = text ? 1 : 0;
	let result = "";
	for (const character of text) {
		const nextLines = character === "\n" ? lines + 1 : lines;
		const characterBytes = Buffer.byteLength(character, "utf8");
		if (bytes + characterBytes > maxBytes || nextLines > maxLines) break;
		result += character;
		bytes += characterBytes;
		lines = nextLines;
	}
	return result;
}

function takeUtf8Suffix(text: string, maxBytes: number): string {
	let bytes = 0;
	const characters = Array.from(text);
	let start = characters.length;
	while (start > 0) {
		const characterBytes = Buffer.byteLength(characters[start - 1], "utf8");
		if (bytes + characterBytes > maxBytes) break;
		bytes += characterBytes;
		start--;
	}
	return characters.slice(start).join("");
}

function countOccurrences(text: string, character: string): number {
	let count = 0;
	for (const value of text) if (value === character) count++;
	return count;
}

function countLines(text: string): number {
	if (!text) return 0;
	return countOccurrences(text, "\n") + (text.endsWith("\n") ? 0 : 1);
}
