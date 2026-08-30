import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";
import type { ToolName } from "./tool-definitions.js";

const INITIALIZE_TIMEOUT_MS = 15_000;
const TOOL_REQUEST_TIMEOUT_MS = 2_147_483_647;
const MCP_MESSAGE_MAX_BYTES = 1024 * 1024;
const STDERR_MAX_BYTES = 8 * 1024;

export interface McpBridgeEvidence {
	transport: "mcp-stdio";
	daemonBacked: true;
	serverPid: number;
}

export interface McpToolResponse {
	content: unknown;
	isError: boolean;
	bridge: McpBridgeEvidence;
}

export interface CodebaseMemorySession {
	readonly bridge: McpBridgeEvidence;
	callTool(
		tool: ToolName,
		args: Record<string, unknown>,
		signal: AbortSignal | undefined,
	): Promise<McpToolResponse>;
	close(): Promise<void>;
}

export type DaemonClientVerifier = (
	binary: string,
	cwd: string,
	pid: number,
	signal: AbortSignal,
) => Promise<void>;

export type CodebaseMemorySessionFactory = (
	binary: string,
	cwd: string,
	signal: AbortSignal,
	verifyDaemonClient: DaemonClientVerifier,
) => Promise<CodebaseMemorySession>;

export async function createCodebaseMemorySession(
	binary: string,
	cwd: string,
	signal: AbortSignal,
	verifyDaemonClient: DaemonClientVerifier,
	options: { initializeTimeoutMs?: number } = {},
): Promise<CodebaseMemorySession> {
	signal.throwIfAborted();
	const transport = new StdioClientTransport({
		command: binary,
		args: [],
		cwd,
		env: inheritedEnvironment(),
		stderr: "pipe",
		maxBufferSize: MCP_MESSAGE_MAX_BYTES,
	});
	const stderr = new BoundedTailCollector(STDERR_MAX_BYTES);
	const stderrStream = transport.stderr;
	const onStderr = (chunk: unknown) => stderr.append(String(chunk));
	stderrStream?.on("data", onStderr);
	const client = new Client({ name: "pi-cbmem", version: "1" });
	let closed = false;
	let disconnected = false;
	client.onclose = () => {
		disconnected = true;
	};

	const close = async () => {
		if (closed) return;
		closed = true;
		try {
			await client.close();
		} finally {
			stderrStream?.off("data", onStderr);
		}
	};

	try {
		await client.connect(transport, {
			signal,
			timeout: options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS,
		});
		signal.throwIfAborted();
		const serverPid = transport.pid;
		if (!serverPid) throw new Error("Codebase Memory MCP transport did not expose a child PID");
		await verifyDaemonClient(binary, cwd, serverPid, signal);
		signal.throwIfAborted();
		const bridge: McpBridgeEvidence = {
			transport: "mcp-stdio",
			daemonBacked: true,
			serverPid,
		};
		return {
			bridge,
			async callTool(tool, args, callSignal) {
				callSignal?.throwIfAborted();
				if (closed || disconnected) {
					throw sessionClosedError(stderr.text);
				}
				const requestController = new AbortController();
				const onAbort = () => requestController.abort(callSignal?.reason);
				callSignal?.addEventListener("abort", onAbort, { once: true });
				try {
					const result = await client.callTool({ name: tool, arguments: args }, undefined, {
						signal: requestController.signal,
						timeout: TOOL_REQUEST_TIMEOUT_MS,
					});
					callSignal?.throwIfAborted();
					return {
						content: result.content,
						isError: result.isError === true,
						bridge,
					};
				} catch (error) {
					if (callSignal?.aborted) throw abortReason(callSignal);
					if (disconnected) throw sessionClosedError(stderr.text, error);
					throw requestFailure(tool, error);
				} finally {
					callSignal?.removeEventListener("abort", onAbort);
				}
			},
			close,
		};
	} catch (error) {
		await close().catch(() => undefined);
		if (signal.aborted) throw abortReason(signal);
		const diagnostic = diagnosticText(error, stderr.text);
		const suffix = diagnostic ? `: ${diagnostic}` : "";
		throw new Error(`Could not initialize Codebase Memory MCP stdio${suffix}`, { cause: error });
	}
}

class BoundedTailCollector {
	text = "";

	constructor(private readonly maxBytes: number) {}

	append(chunk: string): void {
		this.text += chunk;
		if (Buffer.byteLength(this.text, "utf8") <= this.maxBytes) return;
		const bytes = Buffer.from(this.text, "utf8");
		this.text = bytes.subarray(bytes.length - this.maxBytes).toString("utf8");
	}
}

function inheritedEnvironment(): Record<string, string> {
	return Object.fromEntries(
		Object.entries({ ...process.env, CBM_LOG_LEVEL: "error" }).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

function requestFailure(tool: ToolName, cause: unknown): Error {
	const diagnostic = diagnosticText(cause);
	const suffix = diagnostic ? `: ${diagnostic}` : "";
	return new Error(`codebase-memory-mcp ${tool} MCP request failed${suffix}`, { cause });
}

function sessionClosedError(stderr: string, cause?: unknown): Error {
	const diagnostic = diagnosticText(stderr);
	const suffix = diagnostic ? `: ${diagnostic}` : "";
	return new Error(`Codebase Memory MCP session closed; run /reload to reconnect${suffix}`, {
		cause,
	});
}

function diagnosticText(...values: unknown[]): string {
	const unique = new Set(
		values
			.map((value) => (value instanceof Error ? value.message : String(value)).trim())
			.filter(Boolean),
	);
	const sanitized = sanitizeTerminalText([...unique].join(": "));
	const bytes = Buffer.from(sanitized, "utf8");
	return bytes.length <= STDERR_MAX_BYTES
		? sanitized
		: bytes.subarray(0, STDERR_MAX_BYTES).toString("utf8");
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException("Codebase Memory MCP operation was aborted", "AbortError");
}
