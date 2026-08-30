import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import type { ToolName } from "../src/tool-definitions.js";
import {
	type CbmemJsonQuery,
	currentRelativePath,
	defaultProjectResolutionService,
	resolveCurrentProject,
} from "../src/worktree-project.js";

const execFileAsync = promisify(execFile);
let fixtureRoot: string;
let sourceRoot: string;
let worktreeRoot: string;
let headSha: string;

beforeAll(async () => {
	fixtureRoot = await mkdtemp(path.join(tmpdir(), "pi-cbmem-worktree-test-"));
	sourceRoot = path.join(fixtureRoot, "source");
	worktreeRoot = path.join(fixtureRoot, "worktree");
	await git(fixtureRoot, "init", "--initial-branch=main", sourceRoot);
	await writeFile(path.join(sourceRoot, "example.ts"), "export const answer = 42;\n", "utf8");
	await git(sourceRoot, "add", "example.ts");
	await git(
		sourceRoot,
		"-c",
		"commit.gpgsign=false",
		"-c",
		"user.name=Pi Test",
		"-c",
		"user.email=pi@example.invalid",
		"commit",
		"-m",
		"test fixture",
	);
	headSha = await git(sourceRoot, "rev-parse", "HEAD");
	await git(sourceRoot, "worktree", "add", "-b", "feature", worktreeRoot, "HEAD");
});

beforeEach(async () => {
	await git(worktreeRoot, "reset", "--hard", headSha);
	await git(worktreeRoot, "clean", "-fd");
	await git(sourceRoot, "reset", "--hard", headSha);
	await git(sourceRoot, "clean", "-fd");
});

afterAll(async () => {
	await rm(fixtureRoot, { force: true, recursive: true });
});

test("current project resolution prefers an exact worktree index", async () => {
	await writeFile(path.join(worktreeRoot, "example.ts"), "dirty\n", "utf8");
	const query = fixtureQuery({ includeWorktree: true });
	const resolution = await resolveCurrentProject(worktreeRoot, undefined, query);

	assert.deepEqual(resolution, {
		kind: "current",
		project: "worktree-project",
		currentRoot: worktreeRoot,
		sourceRoot: worktreeRoot,
		headSha,
	});
	await defaultProjectResolutionService.revalidate(resolution, undefined, query);
	await assert.rejects(
		defaultProjectResolutionService.revalidate(
			resolution,
			undefined,
			fixtureQuery({ currentStatusRoot: sourceRoot, includeWorktree: true }),
		),
		/project root changed while resolving/u,
	);
});

test("unindexed clean linked worktree borrows the matching canonical index", async () => {
	const query = fixtureQuery({ decoyCount: 100 });
	const resolution = await resolveCurrentProject(worktreeRoot, undefined, query);

	assert.deepEqual(resolution, {
		kind: "borrowed",
		project: "source-project",
		currentRoot: worktreeRoot,
		sourceRoot,
		headSha,
	});
	await defaultProjectResolutionService.revalidate(resolution, undefined, query);
});

test("borrowed resolution fails closed for dirty, divergent, stale, and ambiguous contexts", async () => {
	await writeFile(path.join(worktreeRoot, "example.ts"), "dirty\n", "utf8");
	await assert.rejects(
		resolveCurrentProject(worktreeRoot, undefined, fixtureQuery()),
		/must be clean before borrowing/u,
	);

	await git(worktreeRoot, "reset", "--hard", headSha);
	await writeFile(path.join(sourceRoot, "example.ts"), "dirty source\n", "utf8");
	await assert.rejects(
		resolveCurrentProject(worktreeRoot, undefined, fixtureQuery()),
		/must be clean before borrowing/u,
	);

	await git(sourceRoot, "reset", "--hard", headSha);
	await writeFile(path.join(worktreeRoot, "next.ts"), "export const next = true;\n", "utf8");
	await git(worktreeRoot, "add", "next.ts");
	await git(
		worktreeRoot,
		"-c",
		"commit.gpgsign=false",
		"-c",
		"user.name=Pi Test",
		"-c",
		"user.email=pi@example.invalid",
		"commit",
		"-m",
		"diverge",
	);
	await assert.rejects(
		resolveCurrentProject(worktreeRoot, undefined, fixtureQuery()),
		/at different Git HEADs/u,
	);

	await git(worktreeRoot, "reset", "--hard", headSha);
	await assert.rejects(
		resolveCurrentProject(worktreeRoot, undefined, fixtureQuery({ indexedHead: "0".repeat(40) })),
		/does not match this worktree's clean HEAD/u,
	);

	await assert.rejects(
		resolveCurrentProject(worktreeRoot, undefined, fixtureQuery({ duplicateSource: true })),
		/Multiple Codebase Memory projects/u,
	);
});

test("borrowed resolution is invalidated when the worktree changes", async () => {
	const query = fixtureQuery();
	const resolution = await resolveCurrentProject(worktreeRoot, undefined, query);
	await writeFile(path.join(worktreeRoot, "example.ts"), "dirty during call\n", "utf8");

	await assert.rejects(
		defaultProjectResolutionService.revalidate(resolution, undefined, query),
		/must be clean before borrowing/u,
	);
});

test("linked worktrees resolve canonical indexes with a separate Git directory", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "pi-cbmem-separate-git-test-"));
	const separateSource = path.join(root, "source");
	const separateMetadata = path.join(root, "metadata.git");
	const separateWorktree = path.join(root, "worktree");
	try {
		await git(
			root,
			"init",
			"--initial-branch=main",
			`--separate-git-dir=${separateMetadata}`,
			separateSource,
		);
		await writeFile(path.join(separateSource, "example.ts"), "export const value = 1;\n", "utf8");
		await git(separateSource, "add", "example.ts");
		await git(
			separateSource,
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.name=Pi Test",
			"-c",
			"user.email=pi@example.invalid",
			"commit",
			"-m",
			"separate fixture",
		);
		const separateHead = await git(separateSource, "rev-parse", "HEAD");
		await git(
			separateSource,
			"worktree",
			"add",
			"-b",
			"separate-feature",
			separateWorktree,
			"HEAD",
		);
		const query = fixtureQuery({
			indexedGitCommonDir: separateMetadata,
			indexedHead: separateHead,
			sourceRoot: separateSource,
			worktreeRoot: separateWorktree,
		});

		assert.deepEqual(await resolveCurrentProject(separateWorktree, undefined, query), {
			kind: "borrowed",
			project: "source-project",
			currentRoot: separateWorktree,
			sourceRoot: separateSource,
			headSha: separateHead,
		});
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("borrowed paths allow legal two-dot names but reject parent traversal", () => {
	const resolution = {
		kind: "borrowed" as const,
		project: "source-project",
		currentRoot: worktreeRoot,
		sourceRoot,
		headSha,
	};
	assert.equal(
		currentRelativePath(resolution, path.join(sourceRoot, "..foo.ts")),
		path.join(worktreeRoot, "..foo.ts"),
	);
	assert.throws(
		() => currentRelativePath(resolution, path.join(sourceRoot, "..", "outside.ts")),
		/escapes the canonical project root/u,
	);
});

test("project resolution honors cancellation before Git or backend work", async () => {
	const controller = new AbortController();
	controller.abort();
	let queried = false;
	await assert.rejects(
		resolveCurrentProject(worktreeRoot, controller.signal, async () => {
			queried = true;
			return {};
		}),
		(error: Error) => error.name === "AbortError",
	);
	assert.equal(queried, false);
});

function fixtureQuery(
	options: {
		currentStatusRoot?: string;
		decoyCount?: number;
		duplicateSource?: boolean;
		includeWorktree?: boolean;
		indexedGitCommonDir?: string;
		indexedHead?: string;
		sourceRoot?: string;
		worktreeRoot?: string;
	} = {},
): CbmemJsonQuery {
	const sourcePath = options.sourceRoot ?? sourceRoot;
	const worktreePath = options.worktreeRoot ?? worktreeRoot;
	const decoys = Array.from({ length: options.decoyCount ?? 0 }, (_, index) => ({
		name: `decoy-${index}`,
		root_path: path.join(fixtureRoot, `decoy-${index}`),
	}));
	const projects = [
		...decoys,
		{ name: "source-project", root_path: sourcePath },
		...(options.duplicateSource
			? [{ name: "duplicate-source-project", root_path: sourcePath }]
			: []),
		...(options.includeWorktree ? [{ name: "worktree-project", root_path: worktreePath }] : []),
	];
	return async (tool: ToolName, args: Record<string, unknown>) => {
		if (tool === "list_projects") {
			const offset = typeof args.offset === "number" ? args.offset : 0;
			const limit = typeof args.limit === "number" ? args.limit : 100;
			const page = projects.slice(offset, offset + limit);
			return {
				projects: page,
				total: projects.length,
				offset,
				limit,
				returned: page.length,
				has_more: offset + page.length < projects.length,
			};
		}
		if (tool === "index_status") {
			return {
				project: args.project,
				status: "ready",
				root_path:
					args.project === "worktree-project"
						? (options.currentStatusRoot ?? worktreePath)
						: sourcePath,
			};
		}
		if (tool === "search_graph") {
			return {
				total: 1,
				count: 1,
				cols: [
					"name",
					"label",
					"lines",
					"in",
					"out",
					"head_sha",
					"git_common_dir",
					"worktree_root",
					"is_worktree",
				],
				groups: [
					{
						rows: [
							[
								"main",
								"Branch",
								"",
								0,
								0,
								options.indexedHead ?? headSha,
								options.indexedGitCommonDir ?? ".git",
								sourcePath,
								false,
							],
						],
					},
				],
				has_more: false,
			};
		}
		throw new Error(`Unexpected fixture tool: ${tool}`);
	};
}

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await execFileAsync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
	});
	return result.stdout.trim();
}
