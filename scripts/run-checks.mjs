#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import concurrently from "concurrently";
import { changedFilesSince } from "./select-affected-tests.mjs";
import { selectAffectedTypechecks } from "./select-staged-typechecks.mjs";

const checks = ["biome:check", "check:boundaries", "typecheck"];
const affectedBase = process.env.PI_EXTENSIONS_AFFECTED_BASE;

if (!affectedBase) {
	runNpm(["run", "build"]);
	await runChecks(checks.map((check) => ({ command: `npm:${check}`, name: check })));
	process.exit(process.exitCode ?? 0);
}

let selection;
try {
	selection = selectAffectedTypechecks(
		process.cwd(),
		changedFilesSince(process.cwd(), affectedBase),
	);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`Could not select affected checks (${message}); falling back to all checks.`);
	runNpm(["run", "build"]);
	await runChecks(checks.map((check) => ({ command: `npm:${check}`, name: check })));
	process.exit(process.exitCode ?? 0);
}

if (selection.mode === "full") {
	console.log(`Running all checks: ${selection.reason}.`);
	runNpm(["run", "build"]);
	await runChecks(checks.map((check) => ({ command: `npm:${check}`, name: check })));
	process.exit(process.exitCode ?? 0);
}

console.log(
	selection.mode === "skip"
		? `Running change-scoped checks without workspace typechecks: ${selection.reason}.`
		: `Running checks for ${selection.workspaceDirectories.join(", ")}: ${selection.reason}.`,
);
if (selection.buildWorkspaceNames.length > 0) {
	runWorkspaceScript("build", selection.buildWorkspaceNames, true);
}
process.env.PI_EXTENSIONS_BUILD_READY = "1";

const affectedChecks = [
	{ command: "node ./scripts/run-affected-biome.mjs", name: "biome:check" },
	{ command: "npm run check:boundaries", name: "check:boundaries" },
];
if (selection.mode !== "skip") {
	affectedChecks.push({ command: "npm run typecheck -- --affected", name: "typecheck" });
}
await runChecks(affectedChecks);

async function runChecks(tasks) {
	console.log(`Running checks in parallel: ${tasks.map(({ name }) => name).join(", ")}`);
	const env = { ...process.env, PI_EXTENSIONS_BUILD_READY: "1" };
	const { result } = concurrently(
		tasks.map((task) => ({ ...task, env })),
		{ prefix: "name", prefixColors: ["auto"] },
	);

	try {
		await result;
	} catch {
		process.exitCode = 1;
	}
}

function runWorkspaceScript(script, workspaceNames, ifPresent = false) {
	const workspaceArgs = workspaceNames.flatMap((workspaceName) => ["--workspace", workspaceName]);
	if (ifPresent) workspaceArgs.push("--if-present");
	runNpm([...workspaceArgs, "run", script]);
}

function runNpm(args) {
	const command = process.env.npm_execpath
		? process.execPath
		: process.platform === "win32"
			? "npm.cmd"
			: "npm";
	const commandArgs = process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
	const result = spawnSync(command, commandArgs, { stdio: "inherit" });
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}
