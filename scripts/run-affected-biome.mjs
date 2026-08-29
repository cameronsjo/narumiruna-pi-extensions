#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedFilesSince } from "./select-affected-tests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.PI_EXTENSIONS_AFFECTED_BASE;
if (!base) {
	console.error("PI_EXTENSIONS_AFFECTED_BASE is required for affected Biome checks.");
	process.exit(1);
}

const targets = changedFilesSince(root, base)
	.map((file) => file.split(path.sep).join("/").replace(/^\.\//u, ""))
	.filter((file) => safeExistingTarget(file));
if (targets.length === 0) {
	console.log("Skipping Biome: no changed files remain to check.");
	process.exit(0);
}

const biome = path.join(
	root,
	"node_modules",
	".bin",
	process.platform === "win32" ? "biome.cmd" : "biome",
);
const result = spawnSync(biome, ["check", "--no-errors-on-unmatched", ...targets], {
	cwd: root,
	stdio: "inherit",
});
if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}
process.exit(result.status ?? 1);

function safeExistingTarget(file) {
	if (!file || file.startsWith("../") || path.posix.isAbsolute(file)) return false;
	if (file === "package-lock.json" || file.startsWith("deprecated/")) return false;
	return fs.existsSync(path.join(root, file));
}
