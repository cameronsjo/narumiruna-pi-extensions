import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import {
	type DeepSeekBalancePayload,
	formatUsageReport,
	formatUsageStatusline,
	normalizeDeepSeekBalancePayload,
	queryProviderUsage,
	type ResolvedUsageAuth,
	resolveUsageAuth,
	SUPPORTED_ADAPTERS,
} from "../src/index.js";

const DEEPSEEK_MODEL = {
	id: "deepseek-v4-pro",
	name: "DeepSeek V4 Pro",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
};

const adapter = SUPPORTED_ADAPTERS.find((candidate) => candidate.id === "deepseek");
assert.ok(adapter);

function balance(
	currency: "CNY" | "USD",
	total: string,
	granted: string,
	toppedUp: string,
): Record<string, unknown> {
	return {
		currency,
		total_balance: total,
		granted_balance: granted,
		topped_up_balance: toppedUp,
	};
}

function availableBalance(): DeepSeekBalancePayload {
	return {
		is_available: true,
		balance_infos: [balance("CNY", "110.00", "10.00", "100.00")],
	};
}

function deepSeekAuth(secret = "deepseek-test-secret"): ResolvedUsageAuth {
	return {
		apiKey: secret,
		headers: { Authorization: `Bearer ${secret}` },
		fingerprint: "fingerprint",
		secrets: [secret, `Bearer ${secret}`],
		model: DEEPSEEK_MODEL as never,
	};
}

test("DeepSeek API balance preserves exact separate currency amounts and deterministic display", () => {
	const report = normalizeDeepSeekBalancePayload(
		{
			is_available: true,
			balance_infos: [
				balance("USD", "0.12345678901234567890", "0", "0.12345678901234567890"),
				balance("CNY", "110.00", "10.00", "100.00"),
			],
		},
		1_000,
	);

	assert.equal(report.providerId, "deepseek");
	assert.equal(report.source, "deepseek-balance");
	assert.deepEqual(report.semantics, { kind: "api-key", label: "DeepSeek API balance" });
	assert.deepEqual(
		report.metrics.map((metric) => [metric.id, metric.value, metric.currency]),
		[
			["api-availability", "available", undefined],
			["cny-total", "110.00", "CNY"],
			["cny-granted", "10.00", "CNY"],
			["cny-topped-up", "100.00", "CNY"],
			["usd-total", "0.12345678901234567890", "USD"],
			["usd-granted", "0", "USD"],
			["usd-topped-up", "0.12345678901234567890", "USD"],
		],
	);
	const formatted = formatUsageReport(report, "current");
	assert.match(formatted, /^DeepSeek API Balance · Current/mu);
	assert.match(formatted, /Semantics: DeepSeek API balance/u);
	assert.match(formatted, /API calls:\s+Available/u);
	assert.ok(formatted.indexOf("CNY balance:") < formatted.indexOf("USD balance:"));
	assert.match(formatted, /Total balance:\s+CNY 110\.00/u);
	assert.match(formatted, /Total balance:\s+USD 0\.12345678901234567890/u);
	assert.equal(formatUsageStatusline(report), "deepseek CNY 110.00 · USD 0.12345678901234567890");
});

test("DeepSeek API balance reports provider availability without inventing quota semantics", () => {
	const report = normalizeDeepSeekBalancePayload(
		{
			is_available: false,
			balance_infos: [balance("USD", "0.00", "0.00", "0.00")],
		},
		2_000,
	);

	assert.match(formatUsageReport(report, "configured"), /^DeepSeek API Balance · Configured/mu);
	assert.match(formatUsageReport(report, "configured"), /API calls:\s+Unavailable/u);
	assert.equal(formatUsageStatusline(report), "deepseek API unavailable");
	assert.doesNotMatch(formatUsageReport(report, "configured"), /quota|reset|historical/iu);
});

test("DeepSeek API balance rejects malformed, ambiguous, or hostile response fields", () => {
	const invalid: Array<[DeepSeekBalancePayload, RegExp]> = [
		[{}, /availability/iu],
		[{ is_available: "yes", balance_infos: [] }, /availability/iu],
		[{ is_available: true }, /no balance information/iu],
		[{ is_available: true, balance_infos: [] }, /no balance information/iu],
		[{ is_available: true, balance_infos: [null] }, /row was not an object/iu],
		[
			{
				is_available: true,
				balance_infos: [
					{
						...balance("CNY", "1.00", "0.00", "1.00"),
						currency: "EUR",
					},
				],
			},
			/unsupported currency/iu,
		],
		[
			{
				is_available: true,
				balance_infos: [balance("CNY", "1.00", "0.00", "1.00"), balance("CNY", "2", "1", "1")],
			},
			/repeated CNY/iu,
		],
		[
			{
				is_available: true,
				balance_infos: [{ ...balance("USD", "1", "0", "1"), total_balance: "-1" }],
			},
			/total balance/iu,
		],
		[
			{
				is_available: true,
				balance_infos: [{ ...balance("USD", "1", "0", "1"), granted_balance: "1e3" }],
			},
			/granted balance/iu,
		],
		[
			{
				is_available: true,
				balance_infos: [{ ...balance("USD", "1", "0", "1"), topped_up_balance: `1\u001b[31m` }],
			},
			/topped-up balance/iu,
		],
		[
			{
				is_available: true,
				balance_infos: [balance("USD", "9".repeat(65), "0", "0")],
			},
			/total balance/iu,
		],
	];
	for (const [payload, pattern] of invalid) {
		assert.throws(() => normalizeDeepSeekBalancePayload(payload, 0), pattern);
	}
});

test("DeepSeek runtime auth accepts only official model and resolved-auth origins", async () => {
	const { ctx: officialContext } = createMockContext({
		model: DEEPSEEK_MODEL,
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({
				ok: true,
				headers: {
					Authorization: "Bearer current-deepseek-key",
					"X-Private": "must-not-send",
				},
			}),
			getProviderAuth: async () => ({ auth: { apiKey: "provider-key" } }),
			getAvailable: () => [DEEPSEEK_MODEL],
			getAll: () => [DEEPSEEK_MODEL],
		},
	});
	const auth = await resolveUsageAuth(officialContext, adapter);
	assert.deepEqual(auth?.headers, { Authorization: "Bearer current-deepseek-key" });
	assert.ok(!auth?.secrets.includes("must-not-send"));

	const fetchMock = vi.spyOn(globalThis, "fetch");
	try {
		const { ctx: nonBearerContext } = createMockContext({
			model: DEEPSEEK_MODEL,
			modelRegistry: {
				getApiKeyAndHeaders: async () => ({
					ok: true,
					headers: { Authorization: "Basic must-not-send" },
				}),
				getProviderAuth: async () => ({ auth: { apiKey: "provider-key" } }),
				getAvailable: () => [DEEPSEEK_MODEL],
				getAll: () => [DEEPSEEK_MODEL],
			},
		});
		await assert.rejects(() => resolveUsageAuth(nonBearerContext, adapter), /requires Bearer/iu);

		for (const [modelBaseUrl, authBaseUrl, pattern] of [
			["https://proxy.example.test/v1", undefined, /custom.*official/iu],
			[DEEPSEEK_MODEL.baseUrl, "https://proxy.example.test/v1", /proxy-resolved.*official/iu],
		] as const) {
			const model = { ...DEEPSEEK_MODEL, baseUrl: modelBaseUrl };
			const { ctx } = createMockContext({
				model,
				modelRegistry: {
					getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "must-not-send" }),
					getProviderAuth: async () => ({
						auth: {
							apiKey: "must-not-send",
							...(authBaseUrl ? { baseUrl: authBaseUrl } : {}),
						},
					}),
					getAvailable: () => [model],
					getAll: () => [model],
				},
			});
			await assert.rejects(() => resolveUsageAuth(ctx, adapter), pattern);
		}
		assert.equal(fetchMock.mock.calls.length, 0);
	} finally {
		fetchMock.mockRestore();
	}
});

test("DeepSeek transport uses only the fixed balance endpoint and rejects redirects", async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(input), init });
		return new Response(JSON.stringify(availableBalance()), { status: 200 });
	});
	vi.stubGlobal("fetch", fetchMock);
	try {
		const report = await queryProviderUsage(
			adapter,
			deepSeekAuth(),
			new AbortController().signal,
			1_000,
		);
		assert.equal(report.providerId, "deepseek");
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.url, "https://api.deepseek.com/user/balance");
		assert.equal(requests[0]?.init?.method, "GET");
		assert.equal(requests[0]?.init?.redirect, "error");
		assert.deepEqual(requests[0]?.init?.headers, {
			Authorization: "Bearer deepseek-test-secret",
			"User-Agent": "pi-usage",
		});
		assert.ok(requests[0]?.init?.signal instanceof AbortSignal);

		const redirected = new Response(JSON.stringify(availableBalance()), { status: 200 });
		Object.defineProperty(redirected, "redirected", { value: true });
		fetchMock.mockResolvedValueOnce(redirected);
		await assert.rejects(
			() => queryProviderUsage(adapter, deepSeekAuth(), new AbortController().signal, 1_000),
			/refused a redirected response/iu,
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("DeepSeek transport bounds timeout, cancellation, bodies, JSON, and redacted errors", async () => {
	const fetchMock = vi.fn(
		(_input: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
					{ once: true },
				);
			}),
	);
	vi.stubGlobal("fetch", fetchMock);
	try {
		await assert.rejects(
			() => queryProviderUsage(adapter, deepSeekAuth(), new AbortController().signal, 5),
			/Timed out/iu,
		);
		const controller = new AbortController();
		const cancelled = queryProviderUsage(adapter, deepSeekAuth(), controller.signal, 1_000);
		controller.abort();
		await assert.rejects(
			() => cancelled,
			(error: unknown) => error instanceof Error && error.name === "AbortError",
		);

		let cancelledBodies = 0;
		fetchMock.mockResolvedValueOnce(
			new Response(
				new ReadableStream({
					cancel() {
						cancelledBodies += 1;
					},
				}),
				{ status: 200 },
			),
		);
		const bodyController = new AbortController();
		const stalledBody = queryProviderUsage(adapter, deepSeekAuth(), bodyController.signal, 1_000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		bodyController.abort();
		await assert.rejects(
			() => stalledBody,
			(error: unknown) => error instanceof Error && error.name === "AbortError",
		);
		assert.equal(cancelledBodies, 1);

		fetchMock.mockResolvedValueOnce(new Response("x".repeat(70_000), { status: 200 }));
		await assert.rejects(
			() => queryProviderUsage(adapter, deepSeekAuth(), new AbortController().signal, 1_000),
			/exceeded.*bytes/iu,
		);
		fetchMock.mockResolvedValueOnce(new Response("{broken", { status: 200 }));
		await assert.rejects(
			() => queryProviderUsage(adapter, deepSeekAuth(), new AbortController().signal, 1_000),
			/invalid JSON/iu,
		);

		for (const status of [401, 403]) {
			fetchMock.mockResolvedValueOnce(
				new Response("Bearer deepseek-test-secret failed\u001b[31m", {
					status,
					statusText: "Denied",
				}),
			);
			await assert.rejects(
				() => queryProviderUsage(adapter, deepSeekAuth(), new AbortController().signal, 1_000),
				(error: unknown) =>
					error instanceof Error &&
					error.message.includes(String(status)) &&
					!error.message.includes("deepseek-test-secret") &&
					!error.message.includes("\u001b"),
			);
		}
	} finally {
		vi.unstubAllGlobals();
	}
});
