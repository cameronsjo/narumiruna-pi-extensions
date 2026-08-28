import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveTimeoutMs } from "./process.js";
import {
	CHILD_CORE_TOOL_NAMES,
	MAX_SUBAGENT_TASK_BYTES,
	MAX_SUBAGENT_TOOLS,
	SUBAGENT_THINKING_LEVELS,
	type SubagentThinkingLevel,
} from "./types.js";

export const MAX_AGENT_NAME_LENGTH = 64;
export const DEFAULT_AGENT_TASK = "Complete the assigned task and report the result.";
export const DEFAULT_AGENT_TIMEOUT = 300;
const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CHILD_CORE_TOOL_SET = new Set<string>(CHILD_CORE_TOOL_NAMES);
const THINKING_LEVEL_SET = new Set<string>(SUBAGENT_THINKING_LEVELS);

export interface AgentProfile {
	task: string;
	tools: string[];
	timeout: number;
	thinkingLevel: SubagentThinkingLevel;
}

export type AgentProfilesLoadResult =
	| { kind: "missing"; profiles: Record<string, AgentProfile>; document: Record<string, unknown> }
	| { kind: "loaded"; profiles: Record<string, AgentProfile>; document: Record<string, unknown> }
	| { kind: "invalid"; reason: string };

interface AgentProfilesFileSystem {
	mkdirSync: typeof mkdirSync;
	writeFileSync: typeof writeFileSync;
	renameSync: typeof renameSync;
	rmSync: typeof rmSync;
}

export interface AgentProfilesMutationOptions {
	settingsPath?: string;
	fileSystem?: Partial<AgentProfilesFileSystem>;
	expectedProfileDocument?: unknown;
}

export interface AgentProfileStore {
	settingsPath: string;
	read(): AgentProfilesLoadResult;
	create(name: string, profile: AgentProfile): AgentProfilesLoadResult;
	update(name: string, patch: Partial<AgentProfile>): AgentProfilesLoadResult;
	rename(name: string, nextName: string): AgentProfilesLoadResult;
	delete(name: string, expectedProfileDocument?: unknown): AgentProfilesLoadResult;
}

export function agentProfilesPath(): string {
	return path.join(getAgentDir(), "pi-subagents.json");
}

export function createAgentProfileStore(settingsPath = agentProfilesPath()): AgentProfileStore {
	const options = { settingsPath };
	return {
		settingsPath,
		read: () => readAgentProfiles(settingsPath),
		create: (name, profile) => createAgentProfile(name, profile, options),
		update: (name, patch) => updateAgentProfile(name, patch, options),
		rename: (name, nextName) => renameAgentProfile(name, nextName, options),
		delete: (name, expectedProfileDocument) =>
			deleteAgentProfile(name, { ...options, expectedProfileDocument }),
	};
}

export function readAgentProfiles(settingsPath = agentProfilesPath()): AgentProfilesLoadResult {
	let source: string;
	try {
		source = readFileSync(settingsPath, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return { kind: "missing", profiles: {}, document: {} };
		}
		return { kind: "invalid", reason: `${displayPath(settingsPath)}: ${formatError(error)}` };
	}

	let document: unknown;
	try {
		document = JSON.parse(source);
	} catch (error) {
		return {
			kind: "invalid",
			reason: `${displayPath(settingsPath)}: invalid JSON: ${formatError(error)}`,
		};
	}
	const normalized = normalizeAgentProfilesDocument(document);
	return normalized
		? { kind: "loaded", profiles: normalized, document: document as Record<string, unknown> }
		: {
				kind: "invalid",
				reason: `${displayPath(settingsPath)}: invalid agent profile document`,
			};
}

export function loadAgentProfile(value: unknown): AgentProfile | undefined {
	const name = normalizeOptionalAgentName(value);
	if (!name) return undefined;
	const settingsPath = agentProfilesPath();
	const loaded = readAgentProfiles(settingsPath);
	if (loaded.kind === "invalid") throw new Error(loaded.reason);
	if (loaded.kind === "missing") {
		throw new Error(
			`Subagent agent "${name}" is unavailable because ${displayPath(settingsPath)} does not exist.`,
		);
	}
	if (!Object.hasOwn(loaded.profiles, name)) {
		throw new Error(`Subagent agent "${name}" is not defined in ${displayPath(settingsPath)}.`);
	}
	return cloneProfile(loaded.profiles[name] as AgentProfile);
}

export function createAgentProfile(
	nameValue: unknown,
	profile: AgentProfile,
	options: AgentProfilesMutationOptions = {},
): AgentProfilesLoadResult {
	const name = requireAgentName(nameValue);
	return mutateAgentProfiles((document) => {
		if (Object.hasOwn(document, name)) {
			throw new Error(`Subagent agent "${name}" already exists.`);
		}
		document[name] = cloneProfile(profile);
	}, options);
}

export function updateAgentProfile(
	nameValue: unknown,
	patch: Partial<AgentProfile>,
	options: AgentProfilesMutationOptions = {},
): AgentProfilesLoadResult {
	const name = requireAgentName(nameValue);
	return mutateAgentProfiles((document) => {
		const current = ownRecord(document[name]);
		if (!current) throw new Error(`Subagent agent "${name}" does not exist.`);
		document[name] = {
			...current,
			...patch,
			...(patch.tools ? { tools: [...patch.tools] } : {}),
		};
	}, options);
}

export function renameAgentProfile(
	nameValue: unknown,
	nextNameValue: unknown,
	options: AgentProfilesMutationOptions = {},
): AgentProfilesLoadResult {
	const name = requireAgentName(nameValue);
	const nextName = requireAgentName(nextNameValue);
	if (name === nextName) return requireMutableDocument(options);
	return mutateAgentProfiles((document) => {
		if (!Object.hasOwn(document, name)) {
			throw new Error(`Subagent agent "${name}" does not exist.`);
		}
		if (Object.hasOwn(document, nextName)) {
			throw new Error(`Subagent agent "${nextName}" already exists.`);
		}
		document[nextName] = document[name];
		delete document[name];
	}, options);
}

export function deleteAgentProfile(
	nameValue: unknown,
	options: AgentProfilesMutationOptions = {},
): AgentProfilesLoadResult {
	const name = requireAgentName(nameValue);
	return mutateAgentProfiles((document) => {
		if (!Object.hasOwn(document, name)) {
			throw new Error(`Subagent agent "${name}" does not exist.`);
		}
		if (
			options.expectedProfileDocument !== undefined &&
			JSON.stringify(document[name]) !== JSON.stringify(options.expectedProfileDocument)
		) {
			throw new Error(`Subagent agent "${name}" changed after the delete review.`);
		}
		delete document[name];
	}, options);
}

export function normalizeAgentProfile(value: unknown): AgentProfile | undefined {
	const candidate = ownRecord(value);
	if (!candidate) return undefined;
	const task = normalizeTask(candidate.task);
	const tools = normalizeTools(candidate.tools);
	const timeout = normalizeTimeout(candidate.timeout);
	const thinkingLevel = normalizeThinkingLevel(candidate.thinkingLevel);
	if (!task || !tools || timeout === undefined || !thinkingLevel) return undefined;
	return { task, tools, timeout, thinkingLevel };
}

export function requireAgentName(value: unknown): string {
	if (typeof value !== "string") throw new Error("Subagent agent name must be a string.");
	const name = value.trim();
	if (name.length > MAX_AGENT_NAME_LENGTH || !AGENT_NAME_PATTERN.test(name)) {
		throw new Error("Subagent agent name must be lowercase kebab-case with at most 64 characters.");
	}
	return name;
}

function normalizeOptionalAgentName(value: unknown): string | undefined {
	if (value === undefined || value === "") return undefined;
	if (typeof value !== "string") throw new Error("Subagent agent must be a string.");
	if (!value.trim()) return undefined;
	return requireAgentName(value);
}

function normalizeAgentProfilesDocument(value: unknown): Record<string, AgentProfile> | undefined {
	const document = ownRecord(value);
	if (!document) return undefined;
	const profiles: Record<string, AgentProfile> = {};
	for (const [name, candidate] of Object.entries(document)) {
		try {
			requireAgentName(name);
		} catch {
			return undefined;
		}
		const profile = normalizeAgentProfile(candidate);
		if (!profile) return undefined;
		profiles[name] = profile;
	}
	return profiles;
}

function mutateAgentProfiles(
	mutate: (document: Record<string, unknown>) => void,
	options: AgentProfilesMutationOptions,
): AgentProfilesLoadResult {
	const settingsPath = options.settingsPath ?? agentProfilesPath();
	const loaded = readAgentProfiles(settingsPath);
	if (loaded.kind === "invalid") {
		throw new Error(`Cannot save invalid subagent agent profiles: ${loaded.reason}`);
	}
	const document = structuredClone(loaded.document);
	mutate(document);
	if (!normalizeAgentProfilesDocument(document)) {
		throw new Error("Refusing to save invalid subagent agent profiles.");
	}
	publishAgentProfiles(settingsPath, document, options.fileSystem);
	return readAgentProfiles(settingsPath);
}

function requireMutableDocument(options: AgentProfilesMutationOptions): AgentProfilesLoadResult {
	const settingsPath = options.settingsPath ?? agentProfilesPath();
	const loaded = readAgentProfiles(settingsPath);
	if (loaded.kind === "invalid") {
		throw new Error(`Cannot save invalid subagent agent profiles: ${loaded.reason}`);
	}
	return loaded;
}

function publishAgentProfiles(
	settingsPath: string,
	document: Record<string, unknown>,
	overrides: Partial<AgentProfilesFileSystem> = {},
): void {
	const fileSystem = { mkdirSync, writeFileSync, renameSync, rmSync, ...overrides };
	const temporaryPath = path.join(
		path.dirname(settingsPath),
		`.${path.basename(settingsPath)}.${randomUUID()}.tmp`,
	);
	try {
		fileSystem.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		fileSystem.renameSync(temporaryPath, settingsPath);
	} finally {
		try {
			fileSystem.rmSync(temporaryPath, { force: true });
		} catch {
			// Best-effort cleanup must not replace the publication result.
		}
	}
}

function normalizeTask(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const task = value.trim();
	if (task.includes("\0") || Buffer.byteLength(task, "utf8") > MAX_SUBAGENT_TASK_BYTES) {
		return undefined;
	}
	return task;
}

function normalizeTools(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.length > MAX_SUBAGENT_TOOLS) return undefined;
	const tools: string[] = [];
	for (const candidate of value) {
		if (typeof candidate !== "string") return undefined;
		const tool = candidate.trim();
		if (!CHILD_CORE_TOOL_SET.has(tool)) return undefined;
		if (!tools.includes(tool)) tools.push(tool);
	}
	return tools;
}

function normalizeTimeout(value: unknown): number | undefined {
	if (typeof value !== "number") return undefined;
	try {
		resolveTimeoutMs(value);
		return value;
	} catch {
		return undefined;
	}
}

function normalizeThinkingLevel(value: unknown): SubagentThinkingLevel | undefined {
	return typeof value === "string" && THINKING_LEVEL_SET.has(value)
		? (value as SubagentThinkingLevel)
		: undefined;
}

function cloneProfile(profile: AgentProfile): AgentProfile {
	return { ...profile, tools: [...profile.tools] };
}

function ownRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function displayPath(value: string): string {
	return JSON.stringify(value);
}

function formatError(error: unknown): string {
	const value = error instanceof Error ? error.message : String(error);
	return [...value]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			if (character === "\n" || character === "\t") return true;
			if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return false;
			return !(
				(codePoint >= 0x202a && codePoint <= 0x202e) ||
				(codePoint >= 0x2066 && codePoint <= 0x2069)
			);
		})
		.join("");
}
