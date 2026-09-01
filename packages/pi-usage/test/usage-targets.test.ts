import assert from "node:assert/strict";
import { test } from "vitest";
import {
	createUsageTargetSelectOptions,
	type ResolvedUsageAuth,
	resolveUsageTarget,
	type UsageProviderAdapter,
	type UsageProviderTarget,
} from "../src/index.js";

const auth: ResolvedUsageAuth = {
	headers: { Authorization: "Bearer test" },
	fingerprint: "auth",
	secrets: ["test"],
	model: {
		id: "model",
		name: "Model",
		provider: "fake",
		baseUrl: "https://example.test",
	} as never,
};

function targetAdapter(
	id: string,
	singularLabel: string,
	pluralLabel: string,
	targets: readonly UsageProviderTarget[],
): UsageProviderAdapter {
	return {
		id,
		displayName: id,
		semantics: { kind: "project", label: `${singularLabel} usage` },
		targets: {
			singularLabel,
			pluralLabel,
			async list() {
				return targets;
			},
		},
		async query(_auth, _signal, _timeoutMs, _guard, targetId) {
			return {
				providerId: id,
				providerName: id,
				capturedAt: 0,
				source: "fake",
				semantics: { kind: "project", label: `${singularLabel} usage` },
				accountLabel: targetId,
				buckets: [],
				metrics: [],
			};
		},
	};
}

const signal = new AbortController().signal;
const guard = async () => undefined;

test("provider-neutral resolution handles one account and remembered organizations", async () => {
	const accountAdapter = targetAdapter("accounts-provider", "account", "accounts", [
		{ id: "account-1", label: "Primary" },
	]);
	assert.deepEqual(
		await resolveUsageTarget(accountAdapter, auth, undefined, signal, 1_000, guard),
		{ kind: "selected", targetId: "account-1" },
	);

	const organizationAdapter = targetAdapter(
		"organizations-provider",
		"organization",
		"organizations",
		[
			{ id: "org-a", label: "Alpha" },
			{ id: "org-b", label: "Beta" },
		],
	);
	assert.deepEqual(
		await resolveUsageTarget(organizationAdapter, auth, "org-b", signal, 1_000, guard),
		{ kind: "selected", targetId: "org-b" },
	);
	const stale = await resolveUsageTarget(
		organizationAdapter,
		auth,
		"org-gone",
		signal,
		1_000,
		guard,
	);
	assert.equal(stale.kind, "selection-required");
	if (stale.kind === "selection-required") {
		assert.deepEqual(
			stale.choices.map((choice) => choice.id),
			["org-a", "org-b"],
		);
	}
});

test("a second fake provider proves project selection and zero-target failure are generic", async () => {
	const projects = targetAdapter("projects-provider", "project", "projects", [
		{ id: "project-a", label: "Shared" },
		{ id: "project-b", label: "Shared" },
	]);
	const unresolved = await resolveUsageTarget(projects, auth, undefined, signal, 1_000, guard);
	assert.equal(unresolved.kind, "selection-required");
	if (unresolved.kind === "selection-required") {
		const options = createUsageTargetSelectOptions(unresolved.choices);
		assert.equal(new Set(options.options).size, 2);
		assert.equal(options.targetIdFor(options.options[0] ?? ""), "project-a");
		assert.equal(options.targetIdFor(options.options[1] ?? ""), "project-b");
	}

	const empty = targetAdapter("empty-provider", "workspace", "workspaces", []);
	await assert.rejects(
		resolveUsageTarget(empty, auth, undefined, signal, 1_000, guard),
		/workspaces discovery returned no choices/iu,
	);
});

test("target descriptors sanitize terminal input, stay bounded, and reject duplicate IDs", async () => {
	const hostile = targetAdapter("hostile-provider", "team", "teams", [
		{
			id: "team-a",
			label: `Alpha\u001b[31m${"x".repeat(200)}`,
			description: "Line\nTwo",
		},
		{ id: "team-b", label: "Alpha" },
	]);
	const result = await resolveUsageTarget(hostile, auth, undefined, signal, 1_000, guard);
	assert.equal(result.kind, "selection-required");
	if (result.kind === "selection-required") {
		assert.ok(result.choices.every((choice) => !choice.label.includes("\u001b")));
		assert.ok(result.choices.every((choice) => choice.label.length <= 120));
		assert.equal(result.choices[0]?.description, "Line Two");
	}

	const malformed = targetAdapter("malformed-provider", "team", "teams", [
		{ id: "team", label: 42 } as unknown as UsageProviderTarget,
	]);
	await assert.rejects(
		resolveUsageTarget(malformed, auth, undefined, signal, 1_000, guard),
		/invalid display label/iu,
	);

	const duplicate = targetAdapter("duplicate-provider", "team", "teams", [
		{ id: "same", label: "One" },
		{ id: "same", label: "Two" },
	]);
	await assert.rejects(
		resolveUsageTarget(duplicate, auth, undefined, signal, 1_000, guard),
		/repeated same/iu,
	);
});
