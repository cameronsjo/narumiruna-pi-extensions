import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import {
	resolveSubagentSendArguments,
	SUBAGENT_SEND_TOOL_DEFINITION,
	type SubagentSendArguments,
} from "./communication-contract.js";
import {
	type BrokerSendAcknowledgement,
	MAX_IDENTIFIER_LENGTH,
	sanitizeTerminalText,
} from "./message-broker.js";

export const CHILD_COMMUNICATION_TOOL_NAMES = ["subagent_send", "subagent_wait"] as const;

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

const WaitParameters = Type.Object(
	{
		requestId: Type.String({
			description: "Request ID returned by subagent_send.",
			minLength: 1,
			maxLength: MAX_IDENTIFIER_LENGTH,
		}),
		timeout: Type.Optional(
			Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
		),
	},
	{ additionalProperties: false },
);

type WaitArguments = Static<typeof WaitParameters>;

export interface ChildCommunicationClient {
	send(params: SubagentSendArguments, signal?: AbortSignal): Promise<BrokerSendAcknowledgement>;
	wait(requestId: string, timeoutMs: number | undefined, signal?: AbortSignal): Promise<string>;
}

export function createChildCommunicationExtension(
	client: ChildCommunicationClient,
): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			...SUBAGENT_SEND_TOOL_DEFINITION,
			async execute(_toolCallId, params, signal) {
				const selection = resolveSubagentSendArguments(params);
				if (selection.kind === "request" && selection.recipient !== "main") {
					throw new Error('A subagent may send new requests only to recipient "main".');
				}
				const acknowledgement = await client.send(
					selection.kind === "request"
						? { recipient: selection.recipient, message: selection.message }
						: { requestId: selection.requestId, message: selection.message },
					signal,
				);
				return {
					content: [{ type: "text" as const, text: JSON.stringify(acknowledgement) }],
					details: acknowledgement,
				};
			},
		});

		pi.registerTool({
			name: "subagent_wait",
			label: "Subagent · Wait for Main Agent",
			description:
				"Use subagent_wait with a request ID from subagent_send to wait for the main agent's plain-text response. A timeout or caller cancellation stops only this wait and does not cancel the request.",
			promptSnippet: "Use subagent_wait to receive a requested main-agent response",
			parameters: WaitParameters,
			prepareArguments: prepareWaitArguments,
			async execute(_toolCallId, params, signal) {
				const requestId = requiredIdentifier(params.requestId, "requestId");
				const response = await client.wait(requestId, resolveTimeoutMs(params.timeout), signal);
				return {
					content: [{ type: "text" as const, text: sanitizeTerminalText(response) }],
					details: { requestId },
				};
			},
		});
	};
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}
	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return timeoutMs;
}

function prepareWaitArguments(args: unknown): WaitArguments {
	if (!args || typeof args !== "object") return args as WaitArguments;
	if (!Object.hasOwn(args, "timeoutMs")) return args as WaitArguments;
	const record = args as Record<string, unknown>;
	if (typeof record.timeoutMs !== "number") return record as WaitArguments;
	const { timeoutMs, ...prepared } = record;
	if (prepared.timeout === undefined) {
		return { ...prepared, timeout: timeoutMs / 1000 } as WaitArguments;
	}
	return prepared as WaitArguments;
}

function requiredIdentifier(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Subagent ${field} is required.`);
	const identifier = value.trim();
	if (
		identifier.length > MAX_IDENTIFIER_LENGTH ||
		[...identifier].some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
		})
	) {
		throw new Error(`Subagent ${field} is invalid.`);
	}
	return identifier;
}
