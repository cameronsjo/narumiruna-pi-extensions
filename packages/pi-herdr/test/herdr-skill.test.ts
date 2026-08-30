import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const skillUrl = new URL("../skills/herdr/SKILL.md", import.meta.url);

async function readSkill(): Promise<string> {
	return readFile(skillUrl, "utf8");
}

test("protects blocked agent startup and prompting contracts", async () => {
	const skill = await readSkill();
	for (const contract of [
		"the command returns `agent_not_ready` immediately but keeps the name available for `agent read` and `agent send-keys`",
		"Wait until the agent becomes idle before prompting it.",
		"with `agent_blocked` before sending any input",
		"Inspect the blocked UI and ask the user before answering it.",
	]) {
		assert.ok(skill.includes(contract), `missing safety contract: ${contract}`);
	}
});

test("protects stalled prompting and logical-key contracts", async () => {
	const skill = await readSkill();
	assert.match(
		skill,
		/A prompt sent from a non-working state must produce an observed lifecycle change within five seconds\. Otherwise Herdr returns `agent_prompt_stalled`/u,
	);
	assert.match(skill, /Use logical keys for interactive agent UI controls:/u);
	assert.match(skill, /herdr agent send-keys reviewer esc/u);
	assert.match(skill, /Herdr validates all keys before writing any bytes\./u);
});
