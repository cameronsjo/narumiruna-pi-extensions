import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ToolName } from "./tool-definitions.js";

export const CURRENT_PROJECT_ALIAS = "@current";

export const BORROWABLE_TOOL_NAMES = new Set<ToolName>([
	"get_architecture",
	"get_code_snippet",
	"get_graph_schema",
	"index_status",
	"query_graph",
	"search_graph",
	"trace_path",
]);

const PROJECT_PAGE_SIZE = 100;
const GIT_OUTPUT_LIMIT = 64 * 1024;

export interface ProjectResolution {
	kind: "current" | "borrowed";
	project: string;
	currentRoot: string;
	sourceRoot: string;
	headSha: string;
}

export type CbmemJsonQuery = (
	tool: ToolName,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
) => Promise<unknown>;

export interface ProjectResolutionService {
	resolve(
		cwd: string,
		signal: AbortSignal | undefined,
		query: CbmemJsonQuery,
	): Promise<ProjectResolution>;
	revalidate(
		resolution: ProjectResolution,
		signal: AbortSignal | undefined,
		query: CbmemJsonQuery,
	): Promise<void>;
}

interface GitContext {
	root: string;
	gitDir: string;
	commonDir: string;
	canonicalRoot: string;
	headSha: string;
	isWorktree: boolean;
}

interface IndexedProject {
	name: string;
	rootPath: string;
}

interface IndexedBranch {
	headSha: string;
	canonicalRoot: string;
	worktreeRoot: string;
	isWorktree: boolean;
}

export const defaultProjectResolutionService: ProjectResolutionService = {
	resolve: resolveCurrentProject,
	revalidate: revalidateProjectResolution,
};

export async function resolveCurrentProject(
	cwd: string,
	signal: AbortSignal | undefined,
	query: CbmemJsonQuery,
): Promise<ProjectResolution> {
	signal?.throwIfAborted();
	const current = await resolveGitContext(cwd, signal);
	signal?.throwIfAborted();
	const projects = await listIndexedProjects(query, signal);
	signal?.throwIfAborted();

	const exact = projectsAtRoot(projects, current.root);
	if (exact.length > 1) throw ambiguousProjectError(current.root, exact);
	if (exact.length === 1) {
		const exactProject = exact[0];
		if (!exactProject) throw invalidResponse("current project resolution");
		const status = await query("index_status", { project: exactProject.name }, signal);
		signal?.throwIfAborted();
		assertReadyStatus(status, exactProject);
		return {
			kind: "current",
			project: exactProject.name,
			currentRoot: current.root,
			sourceRoot: current.root,
			headSha: current.headSha,
		};
	}

	if (!current.isWorktree) {
		throw new Error(
			`Codebase Memory has no index for the current repository root: ${current.root}`,
		);
	}
	await assertClean(current.root, signal);
	signal?.throwIfAborted();

	const sourceProjects = projectsAtRoot(projects, current.canonicalRoot);
	if (sourceProjects.length === 0) {
		throw new Error(
			`Codebase Memory has no canonical checkout index for this linked worktree: ${current.canonicalRoot}`,
		);
	}
	if (sourceProjects.length > 1) {
		throw ambiguousProjectError(current.canonicalRoot, sourceProjects);
	}

	const sourceProject = sourceProjects[0];
	if (!sourceProject) throw invalidResponse("canonical project resolution");
	const status = await query("index_status", { project: sourceProject.name }, signal);
	signal?.throwIfAborted();
	assertReadyStatus(status, sourceProject);

	const source = await resolveGitContext(sourceProject.rootPath, signal);
	signal?.throwIfAborted();
	await assertClean(source.root, signal);
	signal?.throwIfAborted();
	assertMatchingGitContexts(current, source);

	const branch = await readIndexedBranch(sourceProject.name, query, signal);
	signal?.throwIfAborted();
	assertMatchingIndexedBranch(current, source, branch);

	return {
		kind: "borrowed",
		project: sourceProject.name,
		currentRoot: current.root,
		sourceRoot: source.root,
		headSha: current.headSha,
	};
}

export async function revalidateProjectResolution(
	resolution: ProjectResolution,
	signal: AbortSignal | undefined,
	query: CbmemJsonQuery,
): Promise<void> {
	if (resolution.kind !== "borrowed") return;
	signal?.throwIfAborted();
	const current = await resolveGitContext(resolution.currentRoot, signal);
	signal?.throwIfAborted();
	const source = await resolveGitContext(resolution.sourceRoot, signal);
	signal?.throwIfAborted();
	await assertClean(current.root, signal);
	signal?.throwIfAborted();
	await assertClean(source.root, signal);
	signal?.throwIfAborted();
	assertMatchingGitContexts(current, source);
	if (current.headSha !== resolution.headSha) {
		throw changedDuringCallError();
	}
	const branch = await readIndexedBranch(resolution.project, query, signal);
	signal?.throwIfAborted();
	assertMatchingIndexedBranch(current, source, branch);
}

function projectsAtRoot(projects: IndexedProject[], root: string): IndexedProject[] {
	const normalizedRoot = normalizePath(root);
	return projects.filter((project) => normalizePath(project.rootPath) === normalizedRoot);
}

async function listIndexedProjects(
	query: CbmemJsonQuery,
	signal: AbortSignal | undefined,
): Promise<IndexedProject[]> {
	const projects: IndexedProject[] = [];
	let offset = 0;
	while (true) {
		const response = await query(
			"list_projects",
			{
				include_details: true,
				limit: PROJECT_PAGE_SIZE,
				metadata_only: true,
				offset,
			},
			signal,
		);
		signal?.throwIfAborted();
		const page = asRecord(response, "list_projects response");
		const entries = page.projects;
		if (!Array.isArray(entries)) throw invalidResponse("list_projects projects");
		for (const entry of entries) {
			const project = asRecord(entry, "list_projects project");
			if (typeof project.name !== "string" || typeof project.root_path !== "string") {
				throw invalidResponse("list_projects project metadata");
			}
			projects.push({ name: project.name, rootPath: project.root_path });
		}
		if (page.has_more !== true) return projects;
		const returned = typeof page.returned === "number" ? page.returned : entries.length;
		if (returned <= 0) throw invalidResponse("list_projects pagination");
		offset += returned;
	}
}

function assertReadyStatus(status: unknown, project: IndexedProject): void {
	const response = asRecord(status, "index_status response");
	if (response.status !== "ready") {
		throw new Error(`Codebase Memory project is not ready: ${project.name}`);
	}
	if (
		typeof response.root_path !== "string" ||
		normalizePath(response.root_path) !== normalizePath(project.rootPath)
	) {
		throw new Error(`Codebase Memory project root changed while resolving: ${project.name}`);
	}
}

async function readIndexedBranch(
	project: string,
	query: CbmemJsonQuery,
	signal: AbortSignal | undefined,
): Promise<IndexedBranch> {
	const response = await query(
		"search_graph",
		{
			detail: "default",
			fields: ["head_sha", "canonical_root", "worktree_root", "is_worktree"],
			format: "json",
			label: "Branch",
			limit: 2,
			project,
		},
		signal,
	);
	signal?.throwIfAborted();
	const result = asRecord(response, "Branch search response");
	if (!Array.isArray(result.cols) || !Array.isArray(result.groups) || result.total !== 1) {
		throw new Error(`Codebase Memory project has no unique indexed Branch snapshot: ${project}`);
	}
	const cols = result.cols;
	const groups = result.groups;
	const rows = groups.flatMap((group) => {
		const value = asRecord(group, "Branch search group").rows;
		return Array.isArray(value) ? value : [];
	});
	const row = rows[0];
	if (rows.length !== 1 || !Array.isArray(row)) {
		throw new Error(`Codebase Memory project has no unique indexed Branch snapshot: ${project}`);
	}
	const value = (field: string): unknown => {
		const index = cols.indexOf(field);
		return index >= 0 ? row[index] : undefined;
	};
	const headSha = value("head_sha");
	const canonicalRoot = value("canonical_root");
	const worktreeRoot = value("worktree_root");
	const isWorktree = value("is_worktree");
	if (
		typeof headSha !== "string" ||
		typeof canonicalRoot !== "string" ||
		typeof worktreeRoot !== "string" ||
		typeof isWorktree !== "boolean"
	) {
		throw invalidResponse("indexed Branch metadata");
	}
	return { headSha, canonicalRoot, worktreeRoot, isWorktree };
}

function assertMatchingGitContexts(current: GitContext, source: GitContext): void {
	if (
		normalizePath(current.commonDir) !== normalizePath(source.commonDir) ||
		normalizePath(current.canonicalRoot) !== normalizePath(source.canonicalRoot)
	) {
		throw new Error("The current worktree and canonical checkout no longer share a Git repository");
	}
	if (current.headSha !== source.headSha) {
		throw new Error("The current worktree and canonical checkout are at different Git HEADs");
	}
	if (source.isWorktree || normalizePath(source.root) !== normalizePath(current.canonicalRoot)) {
		throw new Error("The indexed source project is not the canonical checkout");
	}
}

function assertMatchingIndexedBranch(
	current: GitContext,
	source: GitContext,
	branch: IndexedBranch,
): void {
	if (
		branch.headSha !== current.headSha ||
		normalizePath(branch.canonicalRoot) !== normalizePath(current.canonicalRoot) ||
		normalizePath(branch.worktreeRoot) !== normalizePath(source.root) ||
		branch.isWorktree
	) {
		throw new Error(
			"The canonical Codebase Memory index does not match this worktree's clean HEAD",
		);
	}
}

async function resolveGitContext(
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<GitContext> {
	const output = await runGit(
		cwd,
		[
			"rev-parse",
			"--path-format=absolute",
			"--show-toplevel",
			"--git-dir",
			"--git-common-dir",
			"HEAD",
		],
		signal,
	);
	signal?.throwIfAborted();
	const lines = output.trim().split(/\r?\n/u);
	if (lines.length !== 4 || lines.some((line) => !line)) {
		throw new Error(`Unable to resolve Git worktree context from: ${cwd}`);
	}
	const [root, gitDir, commonDir, headSha] = lines as [string, string, string, string];
	const canonicalRoot =
		commonDir.endsWith("/.git") || commonDir.endsWith("\\.git") ? dirname(commonDir) : commonDir;
	return {
		root: normalizePath(root),
		gitDir: normalizePath(gitDir),
		commonDir: normalizePath(commonDir),
		canonicalRoot: normalizePath(canonicalRoot),
		headSha,
		isWorktree: normalizePath(gitDir) !== normalizePath(commonDir),
	};
}

async function assertClean(root: string, signal: AbortSignal | undefined): Promise<void> {
	try {
		await runGit(
			root,
			["diff", "--quiet", "HEAD", "--", ".", ":(exclude).codebase-memory"],
			signal,
		);
	} catch (error) {
		if (signal?.aborted) throw abortReason(signal);
		throw new Error(
			`Git worktree must be clean before borrowing a Codebase Memory index: ${root}`,
			{ cause: error },
		);
	}
	signal?.throwIfAborted();
	const untracked = await runGit(
		root,
		["ls-files", "-z", "--others", "--exclude-standard", "--", ".", ":(exclude).codebase-memory"],
		signal,
	);
	signal?.throwIfAborted();
	if (untracked.length > 0) {
		throw new Error(`Git worktree must be clean before borrowing a Codebase Memory index: ${root}`);
	}
}

async function runGit(
	cwd: string,
	args: string[],
	signal: AbortSignal | undefined,
): Promise<string> {
	signal?.throwIfAborted();
	return await new Promise((resolvePromise, reject) => {
		const child = spawn("git", ["-C", cwd, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let forceKillTimer: NodeJS.Timeout | undefined;
		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
			if (forceKillTimer) clearTimeout(forceKillTimer);
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			reject(error);
		};
		const onAbort = () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.kill("SIGTERM");
			forceKillTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, 250);
			forceKillTimer.unref();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			if (Buffer.byteLength(stdout, "utf8") > GIT_OUTPUT_LIMIT) {
				fail(new Error("Git metadata output exceeded 64 KB"));
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
			if (Buffer.byteLength(stderr, "utf8") > GIT_OUTPUT_LIMIT) {
				stderr = stderr.slice(-GIT_OUTPUT_LIMIT);
			}
		});
		child.on("error", fail);
		child.on("close", (code) => {
			if (settled) return;
			if (signal?.aborted) {
				fail(abortReason(signal));
				return;
			}
			if (code !== 0) {
				fail(new Error(stderr.trim() || `git exited with code ${code ?? "unknown"}`));
				return;
			}
			settled = true;
			cleanup();
			resolvePromise(stdout);
		});
	});
}

function normalizePath(path: string): string {
	const normalized = resolve(path).replaceAll("\\", "/");
	return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

export function currentRelativePath(resolution: ProjectResolution, sourcePath: string): string {
	if (!isAbsolute(sourcePath)) throw new Error("Borrowed source path is not absolute");
	const relativePath = relative(resolution.sourceRoot, sourcePath);
	if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
		throw new Error("Borrowed source path escapes the canonical project root");
	}
	return resolve(resolution.currentRoot, relativePath);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse(label);
	return value as Record<string, unknown>;
}

function invalidResponse(label: string): Error {
	return new Error(`Codebase Memory returned invalid ${label}`);
}

function ambiguousProjectError(root: string, projects: IndexedProject[]): Error {
	return new Error(
		`Multiple Codebase Memory projects use ${root}; specify one explicitly: ${projects
			.map(({ name }) => name)
			.sort()
			.join(", ")}`,
	);
}

function changedDuringCallError(): Error {
	return new Error("The borrowed Codebase Memory snapshot changed during the tool call; retry");
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException("Codebase Memory project resolution was aborted", "AbortError");
}
