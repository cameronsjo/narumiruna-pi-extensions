import { StringEnum } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	type ContextEvent,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export const TOOL_NAME = "update_todo_list";
export const WIDGET_KEY = "todo";
export const TODO_CONTEXT_MESSAGE_TYPE = "todo-list-status";
export const TODO_CONTEXT_VERSION = 2;
export const TODO_DETAILS_VERSION = 2;
export const TODO_RESTORED_BOUNDARY_ENTRY_TYPE = "todo-restored-context-boundary";
const TODO_RESTORED_BOUNDARY_VERSION = 1;
const LEGACY_TODO_CONTEXT_VERSION = 1;
const LEGACY_TODO_DETAILS_VERSION = 1;
export const MAX_TODOS = 50;
export const MAX_TODO_STEP_LENGTH = 300;

const WIDGET_OPTIONS = { placement: "aboveEditor" } as const;
const LEGACY_TOOL_NAME = "todo_widget";
const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

type TodoStatus = (typeof TODO_STATUSES)[number];

export interface Todo {
	step: string;
	status: TodoStatus;
}

export interface TodoDetails {
	version: typeof TODO_DETAILS_VERSION;
	todos: Todo[];
}

interface LegacyTodoItem {
	text: string;
	status: TodoStatus;
}

const TodoParameters = Type.Object({
	todos: Type.Array(
		Type.Object({
			step: Type.String({
				minLength: 1,
				maxLength: MAX_TODO_STEP_LENGTH,
				description: "A concise, action-oriented step",
			}),
			status: StringEnum(TODO_STATUSES, {
				description: "The step's current status",
			}),
		}),
		{
			maxItems: MAX_TODOS,
			description: "The complete current todo list; send an empty array to clear it",
		},
	),
});

export default function todoWidgetExtension(pi: ExtensionAPI): void {
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let todos: Todo[] = [];
	let restoredBoundary: { summaryEpoch: string; content: string } | undefined;

	const ownsSession = (ctx: ExtensionContext): boolean => ctx.sessionManager === activeSession;

	const publish = (ctx: ExtensionContext): void => {
		if (!ownsSession(ctx) || ctx.mode !== "tui") return;
		if (todos.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const snapshot = cloneTodos(todos);
		ctx.ui.setWidget(
			WIDGET_KEY,
			(_tui, theme) => ({
				render: (width) => renderTodoWidget(snapshot, theme, width),
				invalidate: () => {},
			}),
			WIDGET_OPTIONS,
		);
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo List",
		description:
			"Replace the current session todo list with the complete supplied todos. Call update_todo_list whenever actual step state changes; keep at most one todo in_progress and send an empty todos array to clear it.",
		promptSnippet: "Maintain the complete session todo list as multi-step work progresses",
		promptGuidelines: [
			"Use update_todo_list to track work with multiple meaningful steps; skip it for simple, single-step tasks.",
			"Use update_todo_list to keep the list aligned with actual work: mark a step in_progress before starting it, mark it completed as soon as it finishes, and revise the list before continuing when the plan changes.",
			"Before a progress report or final response, call update_todo_list to reconcile every todo with actual work; do not report completion while the list is stale.",
			"On every update_todo_list call, send the complete current todos array, keep at most one todo in_progress, and send an empty array when no tracked work remains.",
		],
		parameters: TodoParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			if (!ownsSession(ctx)) {
				throw new Error("Cannot update the todo list because the session changed.");
			}
			validateTodos(params.todos);

			todos = cloneTodos(params.todos);
			publish(ctx);

			const details: TodoDetails = {
				version: TODO_DETAILS_VERSION,
				todos: cloneTodos(todos),
			};
			if (todos.length === 0) {
				return {
					content: [{ type: "text", text: "Todo list cleared." }],
					details,
				};
			}

			const completed = todos.filter((todo) => todo.status === "completed").length;
			const inProgress = todos.some((todo) => todo.status === "in_progress");
			return {
				content: [
					{
						type: "text",
						text: `Todo list updated: ${completed} of ${todos.length} complete${inProgress ? "; 1 in progress" : ""}.`,
					},
				],
				details,
			};
		},
	});

	const restoreBranchState = (ctx: ExtensionContext): void => {
		const branch = ctx.sessionManager.getBranch();
		todos = reconstructTodos(branch);
		restoredBoundary = reconstructRestoredTodoBoundary(branch);
	};

	pi.on("session_start", (_event, ctx) => {
		activeSession = ctx.sessionManager;
		restoreBranchState(ctx);
		publish(ctx);
	});

	pi.on("context", (event, ctx) => {
		if (!ownsSession(ctx)) return;
		const summaryEpoch = leadingSummaryEpoch(event.messages);
		if (restoredBoundary?.summaryEpoch !== summaryEpoch) restoredBoundary = undefined;
		const messages = reconcileTodoContext(event.messages, todos, restoredBoundary?.content);
		if (restoredBoundary === undefined && summaryEpoch) {
			const boundaryMessage = messages[leadingSummaryBoundary(messages)];
			if (isTodoContextMessage(boundaryMessage)) {
				restoredBoundary = { summaryEpoch, content: boundaryMessage.content };
				pi.appendEntry(TODO_RESTORED_BOUNDARY_ENTRY_TYPE, {
					version: TODO_RESTORED_BOUNDARY_VERSION,
					...restoredBoundary,
				});
			}
		}
		if (messages !== event.messages) return { messages };
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		restoreBranchState(ctx);
		publish(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ownsSession(ctx)) return;
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		todos = [];
		restoredBoundary = undefined;
		activeSession = undefined;
	});
}

export function renderTodoWidget(todos: readonly Todo[], theme: Theme, width: number): string[] {
	const completed = todos.filter((todo) => todo.status === "completed").length;
	const divider = theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
	const lines = [divider, theme.fg("muted", `Todo · ${completed}/${todos.length} complete`)];

	const renderWidth = Math.max(0, width);
	for (const todo of todos) {
		const step = sanitizeTodoStep(todo.step);
		let prefix: string;
		let styledStep: string;
		switch (todo.status) {
			case "completed":
				prefix = theme.fg("success", "✓ ");
				styledStep = theme.fg("muted", theme.strikethrough(step));
				break;
			case "in_progress":
				prefix = theme.fg("accent", "▶ ");
				styledStep = theme.fg("accent", theme.bold(step));
				break;
			case "pending":
				prefix = theme.fg("dim", "○ ");
				styledStep = theme.fg("text", step);
				break;
		}

		if (renderWidth <= 2) {
			lines.push(prefix);
			continue;
		}

		const wrappedStep = wrapTextWithAnsi(styledStep, renderWidth - 2);
		lines.push(...wrappedStep.map((line, index) => `${index === 0 ? prefix : "  "}${line}`));
	}

	return lines.map((line) => truncateToWidth(line, renderWidth, ""));
}

export function reconcileTodoContext(
	messages: ContextEvent["messages"],
	todos: readonly Todo[],
	restoredBoundaryContent?: string,
): ContextEvent["messages"] {
	const existing = messages.filter(isTodoContextMessage);
	const withoutExisting = messages.filter((message) => !isTodoContextMessage(message));
	const summaryBoundary = leadingSummaryBoundary(withoutExisting);
	const currentContent =
		todos.length > 0 && !hasModelVisibleTodoState(withoutExisting, todos)
			? todoContextContent(todos)
			: undefined;
	const content = summaryBoundary > 0 ? (restoredBoundaryContent ?? currentContent) : undefined;
	if (
		content !== undefined &&
		existing.length === 1 &&
		messages[summaryBoundary] === existing[0] &&
		existing[0]?.content === content &&
		hasTodoContextVersion(existing[0])
	) {
		return messages;
	}
	if (existing.length === 0 && content === undefined) return messages;
	if (content === undefined) return withoutExisting;

	return [
		...withoutExisting.slice(0, summaryBoundary),
		{
			role: "custom",
			customType: TODO_CONTEXT_MESSAGE_TYPE,
			content,
			display: false,
			details: { version: TODO_CONTEXT_VERSION },
			timestamp: 0,
		},
		...withoutExisting.slice(summaryBoundary),
	];
}

export function sanitizeTodoStep(value: string): string {
	let step = "";
	for (const character of stripTerminalSequences(value).replace(BIDI_CONTROLS, "")) {
		const codePoint = character.codePointAt(0) ?? 0;
		const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
		step += isControl ? " " : character;
	}
	return step.replace(/\s+/gu, " ").trim();
}

function todoContextContent(todos: readonly Todo[]): string {
	return `${todoContextPrefix(TODO_CONTEXT_VERSION)}${JSON.stringify({ todos })}`;
}

function reconstructRestoredTodoBoundary(
	entries: readonly SessionEntry[],
): { summaryEpoch: string; content: string } | undefined {
	const summaryEpoch = leadingSummaryEpoch(buildSessionContext([...entries]).messages);
	if (!summaryEpoch) return undefined;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== TODO_RESTORED_BOUNDARY_ENTRY_TYPE) {
			continue;
		}
		if (!isRestoredTodoBoundaryData(entry.data, summaryEpoch)) continue;
		return { summaryEpoch, content: entry.data.content };
	}
	return undefined;
}

function isRestoredTodoBoundaryData(
	value: unknown,
	summaryEpoch: string,
): value is { version: number; summaryEpoch: string; content: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const data = value as Record<string, unknown>;
	if (
		data.version !== TODO_RESTORED_BOUNDARY_VERSION ||
		data.summaryEpoch !== summaryEpoch ||
		typeof data.content !== "string"
	) {
		return false;
	}
	return isCanonicalTodoContextContent(data.content);
}

function isCanonicalTodoContextContent(content: string): boolean {
	const currentPrefix = todoContextPrefix(TODO_CONTEXT_VERSION);
	if (content.startsWith(currentPrefix)) {
		try {
			const restoredTodos = todosFromToolArguments(JSON.parse(content.slice(currentPrefix.length)));
			return (
				restoredTodos !== undefined &&
				restoredTodos.length > 0 &&
				todoContextContent(restoredTodos) === content
			);
		} catch {
			return false;
		}
	}

	const legacyPrefix = todoContextPrefix(LEGACY_TODO_CONTEXT_VERSION);
	if (!content.startsWith(legacyPrefix)) return false;
	try {
		const restoredItems: unknown = JSON.parse(content.slice(legacyPrefix.length));
		return (
			isLegacyTodoItems(restoredItems) &&
			restoredItems.length > 0 &&
			legacyTodoContextContent(restoredItems) === content
		);
	} catch {
		return false;
	}
}

function todoContextPrefix(version: number): string {
	return `[PI TODO STATUS v${version}]\nCurrent todo list as JSON data:\n`;
}

function legacyTodoContextContent(items: readonly LegacyTodoItem[]): string {
	const canonicalItems = items.map((item) => ({ text: item.text, status: item.status }));
	return `${todoContextPrefix(LEGACY_TODO_CONTEXT_VERSION)}${JSON.stringify(canonicalItems)}`;
}

function hasModelVisibleTodoState(
	messages: ContextEvent["messages"],
	todos: readonly Todo[],
): boolean {
	const currentResults = new Map<string, string>();
	for (const message of messages) {
		if (
			message.role !== "toolResult" ||
			message.isError ||
			(message.toolName !== TOOL_NAME && message.toolName !== LEGACY_TOOL_NAME)
		) {
			continue;
		}
		const resultTodos = todosFromDetails(message.details);
		if (resultTodos !== undefined && todosEqual(resultTodos, todos)) {
			currentResults.set(message.toolCallId, message.toolName);
		}
	}
	if (currentResults.size === 0) return false;

	return messages.some(
		(message) =>
			message.role === "assistant" &&
			message.content.some((content) => {
				if (content.type !== "toolCall" || currentResults.get(content.id) !== content.name) {
					return false;
				}
				const argumentTodos = todosFromToolArguments(content.arguments);
				return argumentTodos !== undefined && todosEqual(argumentTodos, todos);
			}),
	);
}

function todosFromToolArguments(value: unknown): Todo[] | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (isTodos(record.todos)) return cloneTodos(record.todos);
	if (isLegacyTodoItems(record.items)) return migrateLegacyItems(record.items);
	return undefined;
}

type TodoContextMessage = Extract<ContextEvent["messages"][number], { role: "custom" }> & {
	content: string;
};

function isTodoContextMessage(
	message: ContextEvent["messages"][number],
): message is TodoContextMessage {
	return message.role === "custom" && message.customType === TODO_CONTEXT_MESSAGE_TYPE;
}

function hasTodoContextVersion(message: TodoContextMessage): boolean {
	return (
		typeof message.details === "object" &&
		message.details !== null &&
		!Array.isArray(message.details) &&
		(message.details as Record<string, unknown>).version === TODO_CONTEXT_VERSION
	);
}

function leadingSummaryEpoch(messages: ContextEvent["messages"]): string | undefined {
	const boundary = leadingSummaryBoundary(messages);
	return boundary === 0 ? undefined : JSON.stringify(messages.slice(0, boundary));
}

function leadingSummaryBoundary(messages: ContextEvent["messages"]): number {
	let index = 0;
	while (index < messages.length) {
		const role = messages[index]?.role;
		if (role !== "compactionSummary" && role !== "branchSummary") break;
		index += 1;
	}
	return index;
}

function validateTodos(todos: readonly Todo[]): void {
	for (const [index, todo] of todos.entries()) {
		if (todo.step.trim().length === 0) {
			throw new Error(`Todo ${index + 1} must contain a non-whitespace step.`);
		}
	}

	const currentCount = todos.filter((todo) => todo.status === "in_progress").length;
	if (currentCount > 1) {
		throw new Error("Todo list can contain at most one in_progress todo.");
	}
}

function reconstructTodos(entries: readonly SessionEntry[]): Todo[] {
	let restored: Todo[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (
			message.role !== "toolResult" ||
			(message.toolName !== TOOL_NAME && message.toolName !== LEGACY_TOOL_NAME)
		) {
			continue;
		}
		const resultTodos = todosFromDetails(message.details);
		if (resultTodos !== undefined) restored = resultTodos;
	}
	return restored;
}

function todosFromDetails(value: unknown): Todo[] | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (record.version === TODO_DETAILS_VERSION && isTodos(record.todos)) {
		return cloneTodos(record.todos);
	}
	if (record.version === LEGACY_TODO_DETAILS_VERSION && isLegacyTodoItems(record.items)) {
		return migrateLegacyItems(record.items);
	}
	return undefined;
}

function isTodos(value: unknown): value is Todo[] {
	return hasValidTodoShape(value, "step");
}

function isLegacyTodoItems(value: unknown): value is LegacyTodoItem[] {
	return hasValidTodoShape(value, "text");
}

function hasValidTodoShape(value: unknown, stepProperty: "step" | "text"): boolean {
	if (!Array.isArray(value) || value.length > MAX_TODOS) return false;

	let currentCount = 0;
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
		const record = entry as Record<string, unknown>;
		const step = record[stepProperty];
		if (
			typeof step !== "string" ||
			step.length === 0 ||
			step.length > MAX_TODO_STEP_LENGTH ||
			step.trim().length === 0 ||
			!TODO_STATUSES.includes(record.status as TodoStatus)
		) {
			return false;
		}
		if (record.status === "in_progress") currentCount += 1;
	}
	return currentCount <= 1;
}

function todosEqual(left: readonly Todo[], right: readonly Todo[]): boolean {
	return (
		left.length === right.length &&
		left.every(
			(todo, index) => todo.step === right[index]?.step && todo.status === right[index]?.status,
		)
	);
}

function migrateLegacyItems(items: readonly LegacyTodoItem[]): Todo[] {
	return items.map((item) => ({ step: item.text, status: item.status }));
}

function cloneTodos(todos: readonly Todo[]): Todo[] {
	return todos.map((todo) => ({ step: todo.step, status: todo.status }));
}
