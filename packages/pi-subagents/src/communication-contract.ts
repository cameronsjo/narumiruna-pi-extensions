import { type Static, Type } from "typebox";
import { MAX_IDENTIFIER_LENGTH, MAX_MESSAGE_BYTES, validateMessage } from "./message-broker.js";

export const SUBAGENT_SEND_TOOL_DEFINITION = {
	name: "subagent_send",
	label: "Subagent · Send",
	description:
		'Use subagent_send to send one request or response. For a new request, provide recipient ("main" from a subagent, or an active job ID from the main agent) and omit requestId. To answer a pending request, provide requestId and omit recipient. Provide exactly one of recipient or requestId.',
	promptSnippet: "Use subagent_send to send or answer one subagent message",
	parameters: Type.Object(
		{
			recipient: Type.Optional(
				Type.String({
					description:
						'Recipient for a new request: "main" from a subagent, or an active job ID from the main agent. Omit when answering a request.',
					minLength: 1,
					maxLength: MAX_IDENTIFIER_LENGTH,
				}),
			),
			requestId: Type.Optional(
				Type.String({
					description: "Pending request to answer. Omit when starting a new request.",
					minLength: 1,
					maxLength: MAX_IDENTIFIER_LENGTH,
				}),
			),
			message: Type.String({
				description: "Plain-text request or response. Maximum 50 KiB.",
				minLength: 1,
				maxLength: MAX_MESSAGE_BYTES,
			}),
		},
		{ additionalProperties: false },
	),
} as const;

export type SubagentSendArguments = Static<typeof SUBAGENT_SEND_TOOL_DEFINITION.parameters>;

export type SubagentSendSelection =
	| { kind: "request"; recipient: string; message: string }
	| { kind: "response"; requestId: string; message: string };

export function resolveSubagentSendArguments(params: SubagentSendArguments): SubagentSendSelection {
	validateMessage(params.message, "Subagent message");
	const recipient = optionalIdentifier(params.recipient, "recipient");
	const requestId = optionalIdentifier(params.requestId, "requestId");
	if ((recipient === undefined) === (requestId === undefined)) {
		throw new Error("subagent_send requires exactly one of recipient or requestId.");
	}
	return recipient !== undefined
		? { kind: "request", recipient, message: params.message }
		: { kind: "response", requestId: requestId ?? "", message: params.message };
}

function optionalIdentifier(value: string | undefined, field: string): string | undefined {
	if (value === undefined) return undefined;
	const identifier = value.trim();
	if (!identifier || identifier.length > MAX_IDENTIFIER_LENGTH || hasControlCharacter(identifier)) {
		throw new Error(`Subagent ${field} is invalid.`);
	}
	return identifier;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
	});
}
