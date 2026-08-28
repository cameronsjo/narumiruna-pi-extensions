import type {
	ExtensionAPI,
	ExtensionCommandContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	type Focusable,
	Key,
	matchesKey,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { MenuContext } from "@narumitw/pi-tui-kit";
import {
	type AgentProfile,
	type AgentProfileStore,
	type AgentProfilesLoadResult,
	createAgentProfileStore,
	DEFAULT_AGENT_TASK,
	DEFAULT_AGENT_TIMEOUT,
	requireAgentName,
} from "./agent-profiles.js";
import { sanitizeTerminalText } from "./message-broker.js";
import type { ActiveJobDisplay } from "./runtime.js";
import {
	CHILD_CORE_TOOL_NAMES,
	DEFAULT_SUBAGENT_TOOLS,
	SUBAGENT_THINKING_LEVELS,
	type SubagentThinkingLevel,
} from "./types.js";

export interface SubagentsMenuOwner {
	signal: AbortSignal;
	isCurrent(): boolean;
}

export interface SubagentsCommandOptions {
	getOwner(ctx: ExtensionCommandContext): SubagentsMenuOwner | undefined;
	getActiveJobs(): ActiveJobDisplay[];
	store?: AgentProfileStore;
}

interface MenuState {
	loaded: AgentProfilesLoadResult;
	profiles: Record<string, AgentProfile>;
	activeJobs: ActiveJobDisplay[];
}

type Screen =
	| "main"
	| "profiles"
	| "profile"
	| "profile-settings"
	| "task"
	| "create"
	| "rename"
	| "timeout"
	| "tools"
	| "delete"
	| "status"
	| "help"
	| "invalid";

type Action =
	| "open-profile"
	| "create"
	| "edit-task"
	| "open-task"
	| "open-tools"
	| "open-timeout"
	| "rename"
	| "set-timeout"
	| "toggle-tool"
	| "set-thinking"
	| "delete";

export function registerSubagentsCommand(pi: ExtensionAPI, options: SubagentsCommandOptions): void {
	pi.registerCommand("subagents", {
		description: "Manage user-defined subagent role profiles",
		handler: async (args, ctx) => {
			if (args.trim()) {
				const message = "/subagents does not accept arguments.";
				if (ctx.hasUI) {
					ctx.ui.notify(message, "warning");
					return;
				}
				throw new Error(message);
			}
			if (ctx.mode !== "tui") {
				const message = "/subagents requires Pi TUI mode.";
				if (ctx.hasUI) {
					ctx.ui.notify(message, "warning");
					return;
				}
				throw new Error(message);
			}
			const owner = options.getOwner(ctx);
			if (!owner || owner.signal.aborted || !owner.isCurrent()) return;
			await showSubagentsMenu(ctx, {
				owner,
				getActiveJobs: options.getActiveJobs,
				store: options.store ?? createAgentProfileStore(),
			});
		},
	});
}

export async function showSubagentsMenu(
	ctx: ExtensionCommandContext,
	options: {
		owner: SubagentsMenuOwner;
		getActiveJobs(): ActiveJobDisplay[];
		store: AgentProfileStore;
	},
): Promise<void> {
	if (ctx.mode !== "tui") throw new Error("The subagents profile manager requires Pi TUI mode.");
	const { defineMenu, runCustomInteraction, runMenu } = await import("@narumitw/pi-tui-kit");
	if (!isCurrent(options.owner)) return;
	let selectedName: string | undefined;
	const settingsPath = safeLine(options.store.settingsPath);
	const getState = (): MenuState => {
		const loaded = options.store.read();
		return {
			loaded,
			profiles: loaded.kind === "invalid" ? {} : loaded.profiles,
			activeJobs: options.getActiveJobs(),
		};
	};
	const selectedProfile = (state: MenuState): AgentProfile | undefined =>
		selectedName && Object.hasOwn(state.profiles, selectedName)
			? state.profiles[selectedName]
			: undefined;

	const menu = defineMenu<MenuState, Screen, Action, ExtensionCommandContext>({
		start: "main",
		screens: {
			main: ({ state }) => {
				const profileCount = Object.keys(state.profiles).length;
				return {
					kind: "actions",
					title: "Pi Subagents",
					lines: [
						`Profiles: ${state.loaded.kind === "invalid" ? "invalid settings" : profileCount} · Active jobs: ${state.activeJobs.length}`,
					],
					items: [
						{
							id: "settings",
							label: "Settings",
							description: "Create and manage role profiles",
							to: state.loaded.kind === "invalid" ? "invalid" : "profiles",
						},
						{ id: "status", label: "Status", to: "status" },
						{ id: "help", label: "Help", to: "help" },
					],
					hint: "close",
				};
			},
			profiles: ({ state }) => {
				const names = Object.keys(state.profiles).sort();
				return {
					kind: "actions",
					title: "Subagent roles",
					lines: [
						names.length === 0
							? `No profiles · ${settingsPath}`
							: `${names.length} ${names.length === 1 ? "profile" : "profiles"} · ${settingsPath}`,
					],
					items: [
						{
							id: "create",
							label: "Create profile…",
							description: "Start with safe defaults",
							to: "create",
						},
						...names.map((name) => ({
							id: `profile:${name}`,
							label: name,
							description: profileSummary(state.profiles[name] as AgentProfile),
							action: "open-profile" as const,
						})),
					],
					hint: "back",
				};
			},
			profile: ({ state }) => {
				const profile = selectedProfile(state);
				if (!selectedName || !profile) return missingProfileScreen();
				return {
					kind: "actions",
					title: `Profile · ${selectedName}`,
					lines: [
						`Tools: ${profile.tools.join(", ") || "none"} · Timeout: ${profile.timeout}s · Thinking: ${profile.thinkingLevel}`,
						`Task: ${taskSummary(profile.task)}`,
					],
					items: [
						{
							id: "profile-settings",
							label: "Profile settings…",
							description: "Edit task, tools, timeout, and thinking level",
							to: "profile-settings",
						},
						{ id: "rename", label: "Rename…", to: "rename" },
						{ id: "delete", label: "Delete…", to: "delete" },
					],
					hint: "back",
				};
			},
			"profile-settings": ({ state }) => {
				const profile = selectedProfile(state);
				if (!selectedName || !profile) return missingProfileScreen();
				return {
					// Kit's standard settings screen preserves injected keybindings and search focus.
					// It also rolls back rejected saves, which the installed Pi SettingsList cannot expose.
					kind: "settings",
					title: `Profile settings · ${selectedName}`,
					lines: ["Changes save immediately. Escape does not roll them back."],
					items: [
						{
							id: "task",
							label: "Task prompt",
							description: "Append trusted user instructions to the child system prompt.",
							currentValue: taskSummary(profile.task),
							action: "open-task",
						},
						{
							id: "tools",
							label: "Tools",
							description: "Choose the default child work capabilities.",
							currentValue: profile.tools.join(", ") || "none",
							action: "open-tools",
						},
						{
							id: "timeout",
							label: "Timeout",
							description: "Set the default execution deadline in seconds.",
							currentValue: `${profile.timeout}s`,
							action: "open-timeout",
						},
						{
							id: "thinking",
							label: "Thinking level",
							description: "Set the default child thinking level.",
							currentValue: profile.thinkingLevel,
							values: [...SUBAGENT_THINKING_LEVELS],
							action: "set-thinking",
						},
					],
				};
			},
			task: ({ state }) => {
				const profile = selectedProfile(state);
				if (!selectedName || !profile) return missingProfileScreen();
				return {
					kind: "actions",
					title: `Task prompt · ${selectedName}`,
					lines: [`Current: ${taskSummary(profile.task)}`],
					items: [{ id: "edit-task", label: "Edit task prompt…", action: "edit-task" }],
					hint: "back",
				};
			},
			create: () => ({
				kind: "input",
				title: "Create subagent role",
				lines: ["Enter a unique lowercase kebab-case name."],
				placeholder: "reviewer",
				action: "create",
				hint: "back",
			}),
			rename: () => ({
				kind: "input",
				title: `Rename profile · ${selectedName ?? "unknown"}`,
				lines: ["Enter the complete new lowercase kebab-case name."],
				placeholder: selectedName ?? "reviewer",
				action: "rename",
				hint: "back",
			}),
			timeout: ({ state }) => ({
				kind: "input",
				title: `Execution timeout · ${selectedName ?? "unknown"}`,
				lines: [
					`Current: ${selectedProfile(state)?.timeout ?? "unavailable"} seconds`,
					"Enter a finite number greater than zero through 2147483.647.",
				],
				placeholder: String(selectedProfile(state)?.timeout ?? DEFAULT_AGENT_TIMEOUT),
				action: "set-timeout",
				hint: "back",
			}),
			tools: ({ state }) => {
				const profile = selectedProfile(state);
				return {
					kind: "multiSelect",
					title: `Tools · ${selectedName ?? "unknown"}`,
					lines: ["Changes save immediately. Escape does not roll them back."],
					items: CHILD_CORE_TOOL_NAMES.map((name) => ({
						id: `tool:${name}`,
						label: name,
						selected: profile?.tools.includes(name) ?? false,
						description: toolDescription(name),
					})),
					action: "toggle-tool",
					viewportSize: 8,
					hint: "back",
					doneLabel: "Back",
				};
			},
			delete: ({ state }) => {
				const profile = selectedProfile(state);
				if (!selectedName || !profile) return missingProfileScreen();
				return {
					kind: "review",
					title: `Delete profile · ${selectedName}?`,
					lines: ["Review managed values and unknown field names. This cannot be undone."],
					content: JSON.stringify(
						{
							name: selectedName,
							...profile,
							unknownFields:
								state.loaded.kind === "invalid"
									? []
									: unknownProfileFields(state.loaded.document[selectedName]),
						},
						null,
						2,
					),
					format: { kind: "code", language: "json" },
					viewportSize: "adaptive",
					confirm: { id: "confirm-delete", label: "Delete profile", action: "delete" },
					hint: "back",
				};
			},
			status: ({ state }) => ({
				kind: "detail",
				title: "Pi Subagents status",
				lines: [
					`Settings: ${settingsPath}`,
					`Settings state: ${state.loaded.kind}`,
					`Profiles: ${Object.keys(state.profiles).length}`,
					`Active jobs: ${state.activeJobs.length}`,
					"Cross-process writes use atomic replacement but no merge lock.",
				],
				hint: "back",
			}),
			help: () => ({
				kind: "detail",
				title: "Pi Subagents help",
				lines: [
					"Profiles provide a child task prompt plus tools, timeout, and thinking-level defaults.",
					"Explicit subagent_spawn values override profile defaults.",
					"Profiles are trusted user settings, not authorization boundaries.",
					`Settings file: ${settingsPath}`,
				],
				hint: "back",
			}),
			invalid: ({ state }) => ({
				kind: "detail",
				title: "Subagent roles · Read only",
				lines: [
					`Fix the settings file before using the manager: ${settingsPath}`,
					safeLine(state.loaded.kind === "invalid" ? state.loaded.reason : "Settings are valid."),
				],
				hint: "back",
			}),
		},
		actions: {
			"open-profile": ({ itemId }) => {
				selectedName = itemId.startsWith("profile:") ? itemId.slice("profile:".length) : undefined;
				return selectedName ? { kind: "to", screen: "profile" } : { kind: "rejected" };
			},
			create: ({ value, ctx: actionCtx }) => {
				assertCurrent(options.owner);
				const name = requireAgentName(value);
				const thinkingLevel = effectiveThinkingLevel(actionCtx.thinkingLevel);
				options.store.create(name, {
					task: DEFAULT_AGENT_TASK,
					tools: [...DEFAULT_SUBAGENT_TOOLS],
					timeout: DEFAULT_AGENT_TIMEOUT,
					thinkingLevel,
				});
				selectedName = name;
				return { kind: "to", screen: "profile" };
			},
			"open-task": () => ({ kind: "to", screen: "task" }),
			"edit-task": async ({ ctx: actionCtx, signal }) => {
				const current = requireSelectedProfile(options.store, selectedName);
				let draft = current.task;
				while (isCurrent(options.owner) && !signal.aborted) {
					const edited = await runCustomInteraction<string | undefined>(actionCtx, {
						signal,
						isCurrent: () => isCurrent(options.owner),
						create: ({ tui, theme, keybindings, complete }) =>
							new TaskPromptEditor({
								tui,
								theme,
								keybindings,
								title: `Task prompt · ${selectedName ?? "unknown"}`,
								draft,
								onSubmit: complete,
								onCancel: () => complete(undefined),
							}),
					});
					if (edited.kind === "stale") return { kind: "rejected" };
					if (edited.kind !== "completed") return { kind: "back" };
					if (edited.value === undefined) return { kind: "back" };
					if (signal.aborted || !isCurrent(options.owner)) return { kind: "rejected" };
					try {
						options.store.update(requireSelectedName(selectedName), { task: edited.value });
						return { kind: "back" };
					} catch (error) {
						draft = edited.value;
						actionCtx.ui.notify(
							`Task prompt was not saved: ${safeLine(formatError(error))}`,
							"error",
						);
					}
				}
				return { kind: "rejected" };
			},
			"open-tools": () => ({ kind: "to", screen: "tools" }),
			"open-timeout": () => ({ kind: "to", screen: "timeout" }),
			rename: ({ value }) => {
				assertCurrent(options.owner);
				const currentName = requireSelectedName(selectedName);
				const nextName = requireAgentName(value);
				options.store.rename(currentName, nextName);
				selectedName = nextName;
				return { kind: "to", screen: "profile" };
			},
			"set-timeout": ({ value }) => {
				assertCurrent(options.owner);
				const timeout = Number(value);
				options.store.update(requireSelectedName(selectedName), { timeout });
				return { kind: "back" };
			},
			"toggle-tool": ({ itemId, selected }) => {
				assertCurrent(options.owner);
				const name = itemId.startsWith("tool:") ? itemId.slice("tool:".length) : "";
				if (!CHILD_CORE_TOOL_NAMES.includes(name as (typeof CHILD_CORE_TOOL_NAMES)[number])) {
					return { kind: "rejected" };
				}
				const profileName = requireSelectedName(selectedName);
				const profile = requireSelectedProfile(options.store, profileName);
				const tools = selected
					? [...new Set([...profile.tools, name])]
					: profile.tools.filter((tool) => tool !== name);
				options.store.update(profileName, { tools });
				return { kind: "stay" };
			},
			"set-thinking": ({ value }) => {
				assertCurrent(options.owner);
				if (!SUBAGENT_THINKING_LEVELS.includes(value as SubagentThinkingLevel)) {
					return { kind: "rejected" };
				}
				options.store.update(requireSelectedName(selectedName), {
					thinkingLevel: value as SubagentThinkingLevel,
				});
				return { kind: "stay" };
			},
			delete: ({ state }) => {
				assertCurrent(options.owner);
				const name = requireSelectedName(selectedName);
				if (state.loaded.kind === "invalid") throw new Error(state.loaded.reason);
				options.store.delete(name, state.loaded.document[name]);
				selectedName = undefined;
				return { kind: "to", screen: "profiles" };
			},
		},
	});

	await runMenu(ctx, menu, {
		getState,
		signal: options.owner.signal,
		isCurrent: options.owner.isCurrent,
		onError: (_menuCtx: MenuContext, error: unknown) => {
			if (isCurrent(options.owner)) {
				ctx.ui.notify(
					`Subagent role profiles were not changed: ${safeLine(formatError(error))}`,
					"error",
				);
			}
		},
	});
}

interface TaskPromptEditorOptions {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	title: string;
	draft: string;
	onSubmit(value: string): void;
	onCancel(): void;
}

class TaskPromptEditor implements Focusable {
	private readonly editor: RawPreservingEditor;
	private finished = false;

	constructor(private readonly options: TaskPromptEditorOptions) {
		const editorTheme: EditorTheme = {
			borderColor: (text) => options.theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => options.theme.fg("accent", text),
				selectedText: (text) => options.theme.fg("accent", text),
				description: (text) => options.theme.fg("muted", text),
				scrollInfo: (text) => options.theme.fg("dim", text),
				noMatch: (text) => options.theme.fg("warning", text),
			},
		};
		this.editor = new RawPreservingEditor(options.tui, editorTheme);
		this.editor.setText(options.draft);
		this.editor.onChange = () => options.tui.requestRender();
	}

	get focused(): boolean {
		return this.editor.focused;
	}

	set focused(value: boolean) {
		this.editor.focused = value;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const border = this.options.theme.fg("border", "─".repeat(safeWidth));
		const title = truncateToWidth(
			this.options.theme.fg("accent", this.options.theme.bold(safeLine(this.options.title))),
			safeWidth,
			"",
		);
		const hint = truncateToWidth(
			this.options.theme.fg("muted", taskEditorHint(this.options.keybindings)),
			safeWidth,
			"",
		);
		return [border, "", title, "", ...this.editor.render(safeWidth), "", hint, "", border];
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	handleInput(data: string): void {
		if (this.finished) return;
		if (matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}
		if (this.options.keybindings.matches(data, "tui.select.cancel")) {
			this.cancel();
			return;
		}
		if (this.options.keybindings.matches(data, "tui.input.newLine")) {
			this.editor.insertTextAtCursor("\n");
		} else if (this.options.keybindings.matches(data, "tui.input.submit")) {
			this.finished = true;
			this.editor.focused = false;
			this.options.onSubmit(this.editor.getExpandedText());
		} else {
			this.editor.handleInput(data);
		}
		this.options.tui.requestRender();
	}

	dispose(): void {
		this.finished = true;
		this.editor.focused = false;
	}

	private cancel(): void {
		this.finished = true;
		this.editor.focused = false;
		this.options.onCancel();
	}
}

class RawPreservingEditor implements Focusable {
	private readonly editor: Editor;
	private readonly rawByMarker = new Map<string, string>();
	private markerCodePoint = 0xe000;
	private pasteBuffer: string | undefined;

	constructor(tui: TUI, theme: EditorTheme) {
		this.editor = new Editor(tui, theme, { paddingX: 0 });
		this.editor.disableSubmit = true;
	}

	get focused(): boolean {
		return this.editor.focused;
	}

	set focused(value: boolean) {
		this.editor.focused = value;
	}

	set onChange(handler: (() => void) | undefined) {
		this.editor.onChange = handler;
	}

	handleInput(data: string): void {
		if (this.pasteBuffer !== undefined) {
			this.pasteBuffer += data;
			this.flushPasteBuffer();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			this.editor.handleInput(data);
			return;
		}
		const pasteStart = data.indexOf(BRACKETED_PASTE_START);
		if (pasteStart >= 0) {
			if (pasteStart > 0) this.editor.handleInput(data.slice(0, pasteStart));
			this.pasteBuffer = data.slice(pasteStart + BRACKETED_PASTE_START.length);
			this.flushPasteBuffer();
			return;
		}
		if (
			[...data].some(
				(character) => isUnsafeDirectEditorCharacter(character) || this.rawByMarker.has(character),
			)
		) {
			this.editor.handleInput(this.encode(data));
			return;
		}
		this.editor.handleInput(data);
	}

	insertTextAtCursor(value: string): void {
		this.editor.insertTextAtCursor(this.encode(value));
	}

	render(width: number): string[] {
		return this.editor
			.render(width)
			.map((line) =>
				[...line].map((character) => (this.rawByMarker.has(character) ? " " : character)).join(""),
			);
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	setText(value: string): void {
		this.rawByMarker.clear();
		this.markerCodePoint = 0xe000;
		this.pasteBuffer = undefined;
		this.editor.setText(this.encode(value));
	}

	getExpandedText(): string {
		return this.decode(this.editor.getExpandedText());
	}

	private flushPasteBuffer(): void {
		if (this.pasteBuffer === undefined) return;
		const pasteEnd = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
		if (pasteEnd < 0) return;
		const raw = this.pasteBuffer.slice(0, pasteEnd);
		const remaining = this.pasteBuffer.slice(pasteEnd + BRACKETED_PASTE_END.length);
		this.pasteBuffer = undefined;
		this.editor.handleInput(`${BRACKETED_PASTE_START}${this.encode(raw)}${BRACKETED_PASTE_END}`);
		if (remaining) this.handleInput(remaining);
	}

	private encode(value: string): string {
		const forbidden = new Set([
			...value,
			...this.editor.getExpandedText(),
			...this.rawByMarker.keys(),
		]);
		return [...value]
			.map((character) => {
				if (!isUnsafeEditorCharacter(character) && !this.rawByMarker.has(character)) {
					return character;
				}
				const marker = this.nextMarker(forbidden);
				this.rawByMarker.set(marker, character);
				forbidden.add(marker);
				return marker;
			})
			.join("");
	}

	private decode(value: string): string {
		return [...value].map((character) => this.rawByMarker.get(character) ?? character).join("");
	}

	private nextMarker(forbidden: ReadonlySet<string>): string {
		for (;;) {
			if (this.markerCodePoint === 0xf900) this.markerCodePoint = 0xf0000;
			if (this.markerCodePoint === 0xffffe) this.markerCodePoint = 0x100000;
			if (this.markerCodePoint > 0x10fffd) {
				throw new Error("Task prompt editor exhausted its safe input markers.");
			}
			const marker = String.fromCodePoint(this.markerCodePoint++);
			if (!forbidden.has(marker)) return marker;
		}
	}
}

const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

function isUnsafeDirectEditorCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0) ?? 0;
	return (
		(codePoint >= 0x7f && codePoint <= 0x9f) ||
		codePoint === 0x2028 ||
		codePoint === 0x2029 ||
		isBidiControl(codePoint)
	);
}

function isUnsafeEditorCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0) ?? 0;
	return (
		character !== "\n" &&
		(codePoint <= 0x1f ||
			(codePoint >= 0x7f && codePoint <= 0x9f) ||
			codePoint === 0x2028 ||
			codePoint === 0x2029 ||
			isBidiControl(codePoint))
	);
}

function isBidiControl(codePoint: number): boolean {
	return (
		codePoint === 0x061c ||
		codePoint === 0x200e ||
		codePoint === 0x200f ||
		(codePoint >= 0x202a && codePoint <= 0x202e) ||
		(codePoint >= 0x2066 && codePoint <= 0x2069)
	);
}

function taskEditorHint(keybindings: KeybindingsManager): string {
	return [
		formatHintKeys(keybindings.getKeys("tui.input.submit"), "save"),
		formatHintKeys(keybindings.getKeys("tui.input.newLine"), "newline"),
		formatHintKeys([...keybindings.getKeys("tui.select.cancel"), "ctrl+c"], "cancel"),
	]
		.filter(Boolean)
		.join(" · ");
}

function formatHintKeys(keys: readonly string[], label: string): string {
	const names = [...new Set(keys.map(formatHintKey).filter(Boolean))];
	return names.length > 0 ? `${names.join("/")} ${label}` : "";
}

function formatHintKey(value: string): string {
	const key = safeLine(value).toLowerCase();
	if (key === "escape") return "esc";
	if (key === "return") return "enter";
	return key;
}

function requireSelectedName(name: string | undefined): string {
	if (!name) throw new Error("No subagent role profile is selected.");
	return name;
}

function requireSelectedProfile(store: AgentProfileStore, name: string | undefined): AgentProfile {
	const selectedName = requireSelectedName(name);
	const loaded = store.read();
	if (loaded.kind === "invalid") throw new Error(loaded.reason);
	if (!Object.hasOwn(loaded.profiles, selectedName)) {
		throw new Error(`Subagent role "${selectedName}" does not exist.`);
	}
	return loaded.profiles[selectedName] as AgentProfile;
}

function effectiveThinkingLevel(value: string | undefined): SubagentThinkingLevel {
	return SUBAGENT_THINKING_LEVELS.includes(value as SubagentThinkingLevel)
		? (value as SubagentThinkingLevel)
		: "medium";
}

function isCurrent(owner: SubagentsMenuOwner): boolean {
	return !owner.signal.aborted && owner.isCurrent();
}

function assertCurrent(owner: SubagentsMenuOwner): void {
	if (!isCurrent(owner)) throw new Error("The subagents menu is stale.");
}

function profileSummary(profile: AgentProfile): string {
	return `${profile.tools.length} tools · ${profile.timeout}s · ${profile.thinkingLevel}`;
}

function taskSummary(task: string): string {
	const normalized = safeLine(task).replace(/\s+/gu, " ").trim();
	return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}

function unknownProfileFields(value: unknown): string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
	const known = new Set(["task", "tools", "timeout", "thinkingLevel"]);
	return Object.keys(value).filter((field) => !known.has(field));
}

function toolDescription(name: (typeof CHILD_CORE_TOOL_NAMES)[number]): string {
	switch (name) {
		case "bash":
		case "powershell":
			return "Unrestricted command execution; can modify files";
		case "edit":
		case "write":
			return "Explicit workspace mutation";
		default:
			return "Read-only work tool";
	}
}

function missingProfileScreen() {
	return {
		kind: "detail" as const,
		title: "Subagent role unavailable",
		lines: ["The selected role profile no longer exists."],
		hint: "back" as const,
	};
}

function safeLine(value: string): string {
	return sanitizeTerminalText(value)
		.replace(/[\n\t]+/gu, " ")
		.trim();
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
