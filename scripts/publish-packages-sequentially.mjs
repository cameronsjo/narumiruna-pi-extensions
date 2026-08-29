#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function publishPackagesSequentially({
	cwd = process.cwd(),
	changesetsOutput = process.env.CHANGESETS_OUTPUT,
	run = spawnSync,
} = {}) {
	if (!changesetsOutput) {
		throw new Error("CHANGESETS_OUTPUT is required by the Changesets Action.");
	}

	mkdirSync(path.dirname(changesetsOutput), { recursive: true });
	writeFileSync(changesetsOutput, "");

	const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "pi-publish-plan-"));
	const planPath = path.join(temporaryDirectory, "publish-plan.json");

	try {
		const changesetsCli = path.join(cwd, "node_modules", "@changesets", "cli", "bin.js");
		const planResult = run(
			process.execPath,
			[changesetsCli, "publish-plan", "--output", planPath],
			{ cwd, env: process.env, stdio: "inherit" },
		);
		if (planResult.error) throw planResult.error;
		if (planResult.status !== 0) return planResult.status ?? 1;

		const plan = readPublishPlan(planPath);
		const published = [];
		const failed = [];
		const tagged = [];

		for (const chunk of plan) {
			for (const release of chunk) {
				const tag = `${release.name}@${release.version}`;
				if (release.kind === "tag-only") {
					writeTagEvent(changesetsOutput, release, tag);
					tagged.push(tag);
					continue;
				}

				console.log(`Publishing ${tag}...`);
				const result = run(
					"npm",
					[
						"publish",
						"--workspace",
						release.name,
						"--access",
						release.access,
						"--tag",
						release.tag,
					],
					{ cwd, env: process.env, stdio: "inherit" },
				);

				if (!result.error && result.status === 0) {
					writeTagEvent(changesetsOutput, release, tag);
					published.push(tag);
					continue;
				}

				const reason =
					result.error?.message ?? `npm publish exited with code ${result.status ?? 1}`;
				failed.push(`${tag}: ${reason}`);
				writeErrorAnnotation(`Failed to publish ${tag}`, reason);
			}
		}

		printSummary("Published", published);
		printSummary("Tags to create", tagged);
		printSummary("Failed", failed);
		return failed.length > 0 ? 1 : 0;
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function readPublishPlan(planPath) {
	const value = JSON.parse(readFileSync(planPath, "utf8"));
	if (value?.version !== 1 || !Array.isArray(value.plan)) {
		throw new Error("Changesets returned an invalid publish plan.");
	}
	for (const chunk of value.plan) {
		if (!Array.isArray(chunk))
			throw new Error("Changesets returned an invalid publish plan chunk.");
		for (const release of chunk) {
			if (
				(release?.kind !== "publish" && release?.kind !== "tag-only") ||
				typeof release.name !== "string" ||
				typeof release.version !== "string" ||
				(release.kind === "publish" &&
					(typeof release.access !== "string" || typeof release.tag !== "string"))
			) {
				throw new Error("Changesets returned an invalid publish plan entry.");
			}
		}
	}
	return value.plan;
}

function writeTagEvent(outputPath, release, tag) {
	writeFileSync(
		outputPath,
		`${JSON.stringify({ type: "git-tag", tag, packageName: release.name })}\n`,
		{ flag: "a" },
	);
}

function writeErrorAnnotation(title, message) {
	console.error(`::error title=${escapeWorkflowProperty(title)}::${escapeWorkflowData(message)}`);
}

function escapeWorkflowData(value) {
	return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeWorkflowProperty(value) {
	return escapeWorkflowData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function printSummary(title, entries) {
	if (entries.length === 0) return;
	console.log(`${title}:\n${entries.map((entry) => `- ${entry}`).join("\n")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	try {
		process.exitCode = publishPackagesSequentially();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeErrorAnnotation("Package publication failed", message);
		process.exitCode = 1;
	}
}
