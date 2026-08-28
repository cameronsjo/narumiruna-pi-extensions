import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
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
	| "create"
	| "rename"
	| "timeout"
	| "tools"
	| "thinking"
	| "delete"
	| "status"
	| "help"
	| "invalid";

type Action =
	| "open-profile"
	| "create"
	| "edit-task"
	| "rename"
	| "set-timeout"
	| "toggle-tool"
	| "set-thinking"
	| "delete";

export function registerSubagentsCommand(pi: ExtensionAPI, options: SubagentsCommandOptions): void {
	pi.registerCommand("subagents", {
		description: "Manage user-defined subagent profiles",
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
	const { defineMenu, runMenu } = await import("@narumitw/pi-tui-kit");
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
							description: "Create and manage agent profiles",
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
					title: "Subagent profiles",
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
						{ id: "task", label: "Task prompt…", action: "edit-task" },
						{ id: "tools", label: `Tools (${profile.tools.length})`, to: "tools" },
						{
							id: "timeout",
							label: `Timeout (${profile.timeout}s)`,
							to: "timeout",
						},
						{
							id: "thinking",
							label: `Thinking level (${profile.thinkingLevel})`,
							to: "thinking",
						},
						{ id: "rename", label: "Rename…", to: "rename" },
						{ id: "delete", label: "Delete…", to: "delete" },
					],
					hint: "back",
				};
			},
			create: () => ({
				kind: "input",
				title: "Create subagent profile",
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
			thinking: ({ state }) => {
				const current = selectedProfile(state)?.thinkingLevel;
				return {
					kind: "choice",
					title: `Thinking level · ${selectedName ?? "unknown"}`,
					items: SUBAGENT_THINKING_LEVELS.map((level) => ({ id: level, label: level })),
					action: "set-thinking",
					currentItemId: current,
					initialItemId: current,
					hint: "back",
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
				title: "Subagent profiles · Read only",
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
			"edit-task": async ({ ctx: actionCtx, signal }) => {
				const current = requireSelectedProfile(options.store, selectedName);
				let draft = current.task;
				while (isCurrent(options.owner) && !signal.aborted) {
					const edited = await actionCtx.ui.editor(
						`Task prompt · ${selectedName ?? "unknown"}`,
						draft,
					);
					if (edited === undefined) return { kind: "stay" };
					if (signal.aborted || !isCurrent(options.owner)) return { kind: "rejected" };
					try {
						options.store.update(requireSelectedName(selectedName), { task: edited });
						return { kind: "stay" };
					} catch (error) {
						draft = edited;
						actionCtx.ui.notify(
							`Task prompt was not saved: ${safeLine(formatError(error))}`,
							"error",
						);
					}
				}
				return { kind: "rejected" };
			},
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
				return { kind: "to", screen: "profile" };
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
			"set-thinking": ({ itemId }) => {
				assertCurrent(options.owner);
				if (!SUBAGENT_THINKING_LEVELS.includes(itemId as SubagentThinkingLevel)) {
					return { kind: "rejected" };
				}
				options.store.update(requireSelectedName(selectedName), {
					thinkingLevel: itemId as SubagentThinkingLevel,
				});
				return { kind: "to", screen: "profile" };
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
					`Subagent profiles were not changed: ${safeLine(formatError(error))}`,
					"error",
				);
			}
		},
	});
}

function requireSelectedName(name: string | undefined): string {
	if (!name) throw new Error("No subagent profile is selected.");
	return name;
}

function requireSelectedProfile(store: AgentProfileStore, name: string | undefined): AgentProfile {
	const selectedName = requireSelectedName(name);
	const loaded = store.read();
	if (loaded.kind === "invalid") throw new Error(loaded.reason);
	if (!Object.hasOwn(loaded.profiles, selectedName)) {
		throw new Error(`Subagent agent "${selectedName}" does not exist.`);
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
		title: "Subagent profile unavailable",
		lines: ["The selected profile no longer exists."],
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
