import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";
import {
	type CodebaseMemorySession,
	type CodebaseMemorySessionFactory,
	createCodebaseMemorySession,
	type DaemonClientVerifier,
} from "./mcp-session.js";

const COMMAND_TIMEOUT_MS = 15_000;
const FORCE_KILL_DELAY_MS = 250;
const MAX_OUTPUT_BYTES = 16 * 1024;

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface DaemonSessionLifecycle {
	generation: number;
	controller?: AbortController;
	startup?: Promise<void>;
	session?: CodebaseMemorySession;
	failure?: Error;
}

export interface DaemonEnsureResult {
	started: boolean;
}

export type DaemonEnsurer = (
	binary: string,
	cwd: string,
	signal: AbortSignal,
) => Promise<DaemonEnsureResult>;

export interface CodebaseMemorySessionRegistry {
	get(sessionManager: ExtensionContext["sessionManager"]): CodebaseMemorySession;
}

export async function ensureCodebaseMemoryDaemon(
	binary: string,
	cwd: string,
	signal: AbortSignal,
): Promise<DaemonEnsureResult> {
	signal.throwIfAborted();
	const status = await runDaemonCommand(binary, ["daemon", "status"], cwd, signal);
	signal.throwIfAborted();
	if (status.code === 0) return { started: false };

	const started = await runDaemonCommand(binary, ["daemon", "start"], cwd, signal);
	signal.throwIfAborted();
	if (started.code !== 0) throw commandFailure("start", started);
	return { started: true };
}

export async function verifyCodebaseMemoryDaemonClient(
	binary: string,
	cwd: string,
	pid: number,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	const status = await runDaemonCommand(binary, ["daemon", "status"], cwd, signal);
	signal.throwIfAborted();
	if (status.code !== 0) throw commandFailure("status", status);
	const committedPids = daemonClientPids(status.stdout);
	if (!committedPids.has(pid)) {
		throw new Error(`Codebase Memory MCP child ${pid} is not committed to the active daemon`);
	}
}

export function registerCodebaseMemoryLifecycle(
	pi: ExtensionAPI,
	binary: string,
	ensureDaemon: DaemonEnsurer = ensureCodebaseMemoryDaemon,
	createSession: CodebaseMemorySessionFactory = createCodebaseMemorySession,
	verifyDaemonClient: DaemonClientVerifier = verifyCodebaseMemoryDaemonClient,
): CodebaseMemorySessionRegistry {
	const sessions = new WeakMap<ExtensionContext["sessionManager"], DaemonSessionLifecycle>();

	pi.on("session_start", async (_event, ctx) => {
		const sessionManager = ctx.sessionManager;
		const lifecycle = sessions.get(sessionManager) ?? { generation: 0 };
		sessions.set(sessionManager, lifecycle);
		const currentGeneration = ++lifecycle.generation;
		const previousStartup = lifecycle.startup;
		const previousSession = lifecycle.session;
		lifecycle.controller?.abort(abortError("Codebase Memory session replaced"));
		lifecycle.controller = undefined;
		lifecycle.session = undefined;
		lifecycle.failure = undefined;
		if (previousStartup) await previousStartup.catch(() => undefined);
		if (previousSession) await previousSession.close();
		if (sessions.get(sessionManager) !== lifecycle || currentGeneration !== lifecycle.generation) {
			return;
		}

		const controller = new AbortController();
		lifecycle.controller = controller;
		let startup!: Promise<void>;
		startup = (async () => {
			try {
				const daemon = await ensureDaemon(binary, ctx.cwd, controller.signal);
				if (controller.signal.aborted || currentGeneration !== lifecycle.generation) return;
				const session = await createSession(binary, ctx.cwd, controller.signal, verifyDaemonClient);
				if (
					controller.signal.aborted ||
					currentGeneration !== lifecycle.generation ||
					sessions.get(sessionManager) !== lifecycle
				) {
					await session.close();
					return;
				}
				lifecycle.session = session;
				if (daemon.started && ctx.hasUI) {
					ctx.ui.notify("Started the Codebase Memory daemon.", "info");
				}
			} catch (error) {
				if (controller.signal.aborted || currentGeneration !== lifecycle.generation) return;
				const failure = sessionStartupFailure(error);
				lifecycle.failure = failure;
				if (!ctx.hasUI) throw failure;
				ctx.ui.notify(failure.message, "warning");
			} finally {
				if (
					currentGeneration === lifecycle.generation &&
					lifecycle.controller === controller &&
					lifecycle.startup === startup
				) {
					lifecycle.controller = undefined;
					lifecycle.startup = undefined;
				}
			}
		})();
		lifecycle.startup = startup;
		await startup;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionManager = ctx.sessionManager;
		const lifecycle = sessions.get(sessionManager);
		if (!lifecycle) return;
		const shutdownGeneration = ++lifecycle.generation;
		const startup = lifecycle.startup;
		const session = lifecycle.session;
		lifecycle.controller?.abort(abortError("Codebase Memory session shut down"));
		lifecycle.controller = undefined;
		lifecycle.session = undefined;
		if (startup) await startup.catch(() => undefined);
		if (session) await session.close();
		if (sessions.get(sessionManager) === lifecycle && shutdownGeneration === lifecycle.generation) {
			sessions.delete(sessionManager);
			lifecycle.startup = undefined;
			lifecycle.failure = undefined;
		}
	});

	return {
		get(sessionManager) {
			const lifecycle = sessions.get(sessionManager);
			if (lifecycle?.session) return lifecycle.session;
			if (lifecycle?.failure) {
				throw new Error(
					`${lifecycle.failure.message} Run /reload to retry the Codebase Memory MCP session.`,
					{ cause: lifecycle.failure },
				);
			}
			throw new Error("Codebase Memory MCP session is not ready; run /reload to reconnect");
		},
	};
}

function runDaemonCommand(
	binary: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
): Promise<CommandResult> {
	signal.throwIfAborted();

	return new Promise((resolve, reject) => {
		let timedOut = false;
		let forceKillTimer: NodeJS.Timeout | undefined;
		const child = execFile(
			binary,
			args,
			{
				cwd,
				env: { ...process.env, CBM_LOG_LEVEL: "error" },
				encoding: "utf8",
				maxBuffer: MAX_OUTPUT_BYTES,
			},
			(error, stdout, stderr) => {
				cleanup();
				if (signal.aborted) {
					reject(abortReason(signal));
					return;
				}
				if (timedOut) {
					reject(new Error(`codebase-memory-mcp ${args.join(" ")} timed out`));
					return;
				}
				if (!error) {
					resolve({ code: 0, stdout, stderr });
					return;
				}
				if (typeof error.code === "number") {
					resolve({ code: error.code, stdout, stderr });
					return;
				}
				reject(error);
			},
		);

		const forceKill = () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.kill("SIGTERM");
			forceKillTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, FORCE_KILL_DELAY_MS);
			forceKillTimer.unref();
		};
		const onAbort = () => forceKill();
		const timeout = setTimeout(() => {
			timedOut = true;
			forceKill();
		}, COMMAND_TIMEOUT_MS);
		timeout.unref();

		function cleanup() {
			clearTimeout(timeout);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			signal.removeEventListener("abort", onAbort);
		}

		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
	});
}

function daemonClientPids(output: string): Set<number> {
	const pids = new Set<number>();
	for (const match of output.matchAll(/^\s*-\s+pid\s+(\d+)\s*$/gmu)) {
		const pid = Number(match[1]);
		if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid);
	}
	return pids;
}

function commandFailure(command: string, result: CommandResult): Error {
	const diagnostic = sanitizeTerminalText(result.stderr.trim() || result.stdout.trim());
	const suffix = diagnostic ? `: ${diagnostic}` : "";
	return new Error(
		`codebase-memory-mcp daemon ${command} exited with code ${result.code}${suffix}`,
	);
}

function sessionStartupFailure(error: unknown): Error {
	const detail = sanitizeTerminalText(error instanceof Error ? error.message : String(error));
	return new Error(`Could not start the Codebase Memory session: ${detail}`, { cause: error });
}

function abortError(message: string): DOMException {
	return new DOMException(message, "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason instanceof Error
		? signal.reason
		: abortError("Codebase Memory daemon command was aborted");
}
