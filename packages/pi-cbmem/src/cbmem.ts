import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import { type BridgeToolDefinition, TOOL_DEFINITIONS, type ToolName } from "./tool-definitions.js";

export { TOOL_NAMES } from "./tool-definitions.js";

const BIN = join(homedir(), ".local", "bin", "codebase-memory-mcp");
const STDERR_MAX_BYTES = 8 * 1024;
const FORCE_KILL_DELAY_MS = 250;

export interface CbmemToolDetails {
	truncated: boolean;
	totalBytes: number;
	totalLines: number;
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

			try {
				const response = stdout.truncated ? stdout.text : extractLastJson(stdout.text);
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

export default function cbmem(pi: ExtensionAPI): void {
	for (const definition of TOOL_DEFINITIONS) registerBridgeTool(pi, definition);
}

function registerBridgeTool(pi: ExtensionAPI, definition: BridgeToolDefinition): void {
	pi.registerTool({
		...definition,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return await callCodebaseMemory(
				definition.name as ToolName,
				params as Record<string, unknown>,
				signal,
				ctx.cwd,
			);
		},
	});
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
