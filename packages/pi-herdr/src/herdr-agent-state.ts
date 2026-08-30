import net from "node:net";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SOURCE = "herdr:pi";

export type AgentState = "working" | "blocked" | "idle";

interface HerdrEnvironment {
	enabled: boolean;
	paneId: string;
	socketEndpoint: string;
}

interface HerdrRequest {
	id: string;
	method: "pane.report_agent" | "pane.report_agent_session";
	params: Record<string, unknown>;
}

interface QueuedState {
	state: AgentState;
	message?: string;
	seq: number;
	signal: AbortSignal;
}

export interface HerdrAgentStateOptions {
	environment?: HerdrEnvironment;
	now?: () => number;
	random?: () => number;
	sendRequest?: (request: HerdrRequest, signal: AbortSignal) => Promise<void>;
}

let reportSeq = Date.now() * 1000;

function nextReportSeq(): number {
	reportSeq += 1;
	return reportSeq;
}

function readEnvironment(environment: NodeJS.ProcessEnv = process.env): HerdrEnvironment {
	const socketPath = environment.HERDR_SOCKET_PATH;
	const paneId = environment.HERDR_PANE_ID;
	return {
		enabled: environment.HERDR_ENV === "1" && !!socketPath && !!paneId,
		paneId: paneId ?? "",
		socketEndpoint:
			process.platform === "win32" && socketPath
				? `\\\\.\\pipe\\${socketPath}`
				: (socketPath ?? ""),
	};
}

function sendRequestAttempt(
	socketEndpoint: string,
	request: HerdrRequest,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<boolean> {
	if (signal.aborted) return Promise.resolve(false);

	return new Promise((resolve) => {
		let finished = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const socket = net.createConnection(socketEndpoint);

		const finish = (delivered: boolean) => {
			if (finished) return;
			finished = true;
			if (timeout) clearTimeout(timeout);
			signal.removeEventListener("abort", abort);
			socket.destroy();
			resolve(delivered);
		};
		const abort = () => finish(false);

		signal.addEventListener("abort", abort, { once: true });
		socket.on("error", () => finish(false));
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on("data", () => finish(true));
		socket.on("end", () => finish(false));
		timeout = setTimeout(() => finish(false), timeoutMs);
		timeout.unref?.();
	});
}

function createSocketSender(socketEndpoint: string) {
	return async (request: HerdrRequest, signal: AbortSignal): Promise<void> => {
		if (await sendRequestAttempt(socketEndpoint, request, 500, signal)) return;
		if (signal.aborted) return;
		await sendRequestAttempt(socketEndpoint, request, 1500, signal);
	};
}

export function createHerdrAgentStateExtension(
	options: HerdrAgentStateOptions = {},
): (pi: ExtensionAPI) => void {
	const environment = options.environment ?? readEnvironment();
	const now = options.now ?? Date.now;
	const random = options.random ?? Math.random;
	const sendRequest = options.sendRequest ?? createSocketSender(environment.socketEndpoint);

	return function herdrAgentState(pi: ExtensionAPI): void {
		if (!environment.enabled) return;

		let sessionGeneration = 0;
		let sessionController = new AbortController();
		let currentAgentSessionId: string | undefined;
		let currentAgentSessionPath: string | undefined;
		let agentActive = false;
		let blockedCount = 0;
		let blockedMessage: string | undefined;
		let lastState: AgentState | undefined;
		let lastMessage: string | undefined;
		let rootSession = false;
		let queuedState: QueuedState | undefined;
		let drainTask: Promise<void> | undefined;

		function requestId(kind?: "session"): string {
			const segment = kind ? `${kind}:` : "";
			return `${SOURCE}:${segment}${now()}:${random().toString(36).slice(2)}`;
		}

		function updateSessionRef(ctx: ExtensionContext): void {
			try {
				const file = ctx.sessionManager.getSessionFile();
				currentAgentSessionPath =
					typeof file === "string" && path.isAbsolute(file) ? file : undefined;
			} catch {
				currentAgentSessionPath = undefined;
			}

			try {
				const id = ctx.sessionManager.getSessionId();
				currentAgentSessionId = typeof id === "string" && id.length > 0 ? id : undefined;
			} catch {
				currentAgentSessionId = undefined;
			}
		}

		function currentSessionRef(): Record<string, unknown> | undefined {
			if (currentAgentSessionPath) return { agent_session_path: currentAgentSessionPath };
			if (currentAgentSessionId) return { agent_session_id: currentAgentSessionId };
			return undefined;
		}

		function withSessionRef(params: Record<string, unknown>): Record<string, unknown> {
			return { ...params, ...currentSessionRef() };
		}

		async function safeSend(request: HerdrRequest, signal: AbortSignal): Promise<void> {
			try {
				await sendRequest(request, signal);
			} catch {
				// Herdr reporting is best-effort and must not interrupt Pi.
			}
		}

		function reportSession(sessionStartSource?: string): Promise<void> {
			const sessionRef = currentSessionRef();
			if (!sessionRef) return Promise.resolve();
			return safeSend(
				{
					id: requestId("session"),
					method: "pane.report_agent_session",
					params: {
						pane_id: environment.paneId,
						source: SOURCE,
						agent: "pi",
						seq: nextReportSeq(),
						session_start_source: sessionStartSource,
						...sessionRef,
					},
				},
				sessionController.signal,
			);
		}

		function stateRequest(state: QueuedState): HerdrRequest {
			return {
				id: requestId(),
				method: "pane.report_agent",
				params: withSessionRef({
					pane_id: environment.paneId,
					source: SOURCE,
					agent: "pi",
					state: state.state,
					message: state.message,
					seq: state.seq,
				}),
			};
		}

		async function drainStateQueue(): Promise<void> {
			while (queuedState) {
				const next = queuedState;
				queuedState = undefined;
				if (!next.signal.aborted) await safeSend(stateRequest(next), next.signal);
			}
		}

		function queueState(state: AgentState, message?: string): void {
			queuedState = {
				state,
				message,
				seq: nextReportSeq(),
				signal: sessionController.signal,
			};
			if (drainTask) return;
			drainTask = drainStateQueue().finally(() => {
				drainTask = undefined;
				if (queuedState) queueState(queuedState.state, queuedState.message);
			});
		}

		function desiredState(): { state: AgentState; message?: string } {
			if (blockedCount > 0) return { state: "blocked", message: blockedMessage };
			if (agentActive) return { state: "working" };
			return { state: "idle" };
		}

		function publishState(force = false): void {
			const next = desiredState();
			if (!force && next.state === lastState && next.message === lastMessage) return;
			lastState = next.state;
			lastMessage = next.message;
			queueState(next.state, next.message);
		}

		pi.on("ui_prompt_start", (event) => {
			if (!rootSession) return;
			blockedCount += 1;
			blockedMessage = event.title?.trim() || event.kind;
			publishState();
		});

		pi.on("ui_prompt_end", () => {
			if (!rootSession) return;
			blockedCount = Math.max(0, blockedCount - 1);
			if (blockedCount === 0) blockedMessage = undefined;
			publishState();
		});

		pi.on("session_start", async (event, ctx) => {
			const generation = ++sessionGeneration;
			sessionController.abort(new DOMException("Herdr session replaced", "AbortError"));
			sessionController = new AbortController();
			rootSession = ctx.mode === "tui";
			agentActive = false;
			blockedCount = 0;
			blockedMessage = undefined;
			lastState = undefined;
			lastMessage = undefined;
			if (!rootSession) return;

			updateSessionRef(ctx);
			await reportSession(event.reason);
			if (generation !== sessionGeneration || sessionController.signal.aborted || !rootSession) {
				return;
			}
			agentActive = !ctx.isIdle();
			publishState(true);
		});

		pi.on("agent_start", (_event, ctx) => {
			if (!rootSession) return;
			updateSessionRef(ctx);
			void reportSession();
			agentActive = true;
			publishState();
		});

		pi.on("agent_settled", (_event, ctx) => {
			if (!rootSession || !ctx.isIdle()) return;
			agentActive = false;
			publishState();
		});

		pi.on("session_shutdown", async () => {
			++sessionGeneration;
			rootSession = false;
			sessionController.abort(new DOMException("Herdr session shut down", "AbortError"));
			queuedState = undefined;
			await drainTask;
			currentAgentSessionId = undefined;
			currentAgentSessionPath = undefined;
		});
	};
}

export default function herdrAgentState(pi: ExtensionAPI): void {
	createHerdrAgentStateExtension()(pi);
}
