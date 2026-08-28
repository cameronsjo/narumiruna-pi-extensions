import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package declares one generated extension and one bundled operating skill", () => {
	const manifest = JSON.parse(
		readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
	) as {
		name: string;
		description: string;
		private: boolean;
		files: string[];
		pi: { extensions: string[]; skills: string[] };
		piExtension: { lifecycle: string };
		peerDependencies: Record<string, string>;
		repository: { directory: string };
	};
	assert.equal(manifest.name, "@narumitw/pi-subagents");
	assert.doesNotMatch(manifest.description, /\b(?:background|bounded)\b/i);
	assert.equal(manifest.private, true);
	assert.equal(manifest.repository.directory, "packages/pi-subagents");
	assert.deepEqual(manifest.pi.extensions, ["./dist/index.ts"]);
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.equal(manifest.piExtension.lifecycle, "stable");
	assert.equal(manifest.peerDependencies["@earendil-works/pi-ai"], "*");
	assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
	assert.ok(manifest.files.includes("src"));
	assert.ok(manifest.files.includes("dist"));
	assert.ok(manifest.files.includes("skills"));
	assert.ok(manifest.files.includes("docs"));
});

test("bundled skill documents every minimal-runtime operating responsibility", () => {
	const skill = readFileSync(
		path.join(packageDirectory, "skills", "using-pi-subagents", "SKILL.md"),
		"utf8",
	);
	assert.match(skill, /^name: using-pi-subagents$/m);
	assert.doesNotMatch(skill, /\b(?:background|bounded)\b/i);
	for (const evidence of [
		/prefer direct work/i,
		/subagent-spawn/i,
		/default of `read`, `grep`, `find`, and `ls`/i,
		/select only from `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`/i,
		/smallest sufficient tool set/i,
		/`bash` and `powershell` as unrestricted command execution/i,
		/inherits the main agent's effective provider and model/i,
		/omit `thinkingLevel` to follow the main agent/i,
		/self-contained tasks/i,
		/shortest realistic execution deadline/i,
		/parallel tool batch/i,
		/subagent-wait/i,
		/wait timeout does not cancel/i,
		/subagent-inspect/i,
		/subagent-cancel/i,
		/subagent-ask/i,
		/subagent-reply/i,
		/not.*user request.*permission/is,
		/partial.*failed.*timed_out.*cancelled/is,
		/writer's statements.*claims rather than proof/is,
		/disjoint.*ownership/is,
		/workspace isolation/i,
	]) {
		assert.match(skill, evidence);
	}
	for (const nonGoal of [
		"retained conversations",
		"user-directed follow-up turns",
		"mailboxes",
		"chains",
		"panels",
		"workflows",
		"nested subagents",
	]) {
		assert.match(skill, new RegExp(nonGoal, "i"));
	}
});
