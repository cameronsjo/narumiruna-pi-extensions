import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";

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
}

export interface DaemonEnsureResult {
	started: boolean;
}

export type DaemonEnsurer = (
	binary: string,
	cwd: string,
	signal: AbortSignal,
) => Promise<DaemonEnsureResult>;

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

export function registerDaemonLifecycle(
	pi: ExtensionAPI,
	binary: string,
	ensureDaemon: DaemonEnsurer = ensureCodebaseMemoryDaemon,
): void {
	const sessions = new WeakMap<ExtensionContext["sessionManager"], DaemonSessionLifecycle>();

	pi.on("session_start", async (_event, ctx) => {
		const sessionManager = ctx.sessionManager;
		const lifecycle = sessions.get(sessionManager) ?? { generation: 0 };
		sessions.set(sessionManager, lifecycle);
		const currentGeneration = ++lifecycle.generation;
		const previousStartup = lifecycle.startup;
		lifecycle.controller?.abort(abortError("Codebase Memory session replaced"));
		if (previousStartup) await previousStartup.catch(() => undefined);
		if (sessions.get(sessionManager) !== lifecycle || currentGeneration !== lifecycle.generation) {
			return;
		}

		const controller = new AbortController();
		lifecycle.controller = controller;
		let startup!: Promise<void>;
		startup = (async () => {
			try {
				const result = await ensureDaemon(binary, ctx.cwd, controller.signal);
				if (controller.signal.aborted || currentGeneration !== lifecycle.generation) return;
				if (result.started && ctx.hasUI) {
					ctx.ui.notify("Started the Codebase Memory daemon.", "info");
				}
			} catch (error) {
				if (controller.signal.aborted || currentGeneration !== lifecycle.generation) return;
				const failure = daemonStartupFailure(error);
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
		lifecycle.controller?.abort(abortError("Codebase Memory session shut down"));
		if (startup) await startup.catch(() => undefined);
		if (sessions.get(sessionManager) === lifecycle && shutdownGeneration === lifecycle.generation) {
			sessions.delete(sessionManager);
			lifecycle.controller = undefined;
			lifecycle.startup = undefined;
		}
	});
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

function commandFailure(command: string, result: CommandResult): Error {
	const diagnostic = sanitizeTerminalText(result.stderr.trim() || result.stdout.trim());
	const suffix = diagnostic ? `: ${diagnostic}` : "";
	return new Error(
		`codebase-memory-mcp daemon ${command} exited with code ${result.code}${suffix}`,
	);
}

function daemonStartupFailure(error: unknown): Error {
	const detail = sanitizeTerminalText(error instanceof Error ? error.message : String(error));
	return new Error(`Could not start the Codebase Memory daemon: ${detail}`, { cause: error });
}

function abortError(message: string): DOMException {
	return new DOMException(message, "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason instanceof Error
		? signal.reason
		: abortError("Codebase Memory daemon command was aborted");
}
