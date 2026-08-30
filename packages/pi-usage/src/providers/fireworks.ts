import { sanitizeDisplayText } from "../core.js";
import type {
	FireworksAccountsPayload,
	FireworksBillingSummaryPayload,
	UsageMetric,
	UsageReport,
} from "../types.js";

const NANOS_PER_UNIT = 1_000_000_000n;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const INTEGER_PATTERN = /^-?\d+$/u;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const MAX_UNITS_CHARS = 20;
const MAX_NANOS_CHARS = 11;

const SERIES_KEYS = ["serverless", "dedicated", "training", "other"] as const;
type SeriesKey = (typeof SERIES_KEYS)[number];

const SERIES_LABELS: Readonly<Record<SeriesKey, string>> = {
	serverless: "Serverless",
	dedicated: "Dedicated deployments",
	training: "Training",
	other: "Other",
};

export function isFireworksAccountId(value: unknown): value is string {
	return typeof value === "string" && ACCOUNT_ID_PATTERN.test(value);
}

export function normalizeFireworksAccountsPayload(payload: FireworksAccountsPayload): string[] {
	if (!Array.isArray(payload.accounts)) {
		throw new Error("Fireworks accounts response did not contain an accounts array.");
	}
	const accounts: string[] = [];
	for (const raw of payload.accounts) {
		const account = asObject(raw);
		if (!account) throw new Error("Fireworks accounts response row was not an object.");
		if (typeof account.name !== "string") {
			throw new Error("Fireworks accounts response omitted the account resource name.");
		}
		const match = /^accounts\/([^/]+)$/u.exec(account.name);
		if (!match || !isFireworksAccountId(match[1])) {
			throw new Error("Fireworks accounts response returned an unsafe account resource name.");
		}
		const accountId = match[1];
		if (accounts.includes(accountId)) {
			throw new Error(`Fireworks accounts response repeated ${accountId}.`);
		}
		accounts.push(accountId);
	}
	return accounts;
}

export function normalizeFireworksBillingSummaryPayload(
	payload: FireworksBillingSummaryPayload,
	accountId: string,
	capturedAt: number,
): UsageReport {
	if (!isFireworksAccountId(accountId)) {
		throw new Error("Fireworks billing summary received an unsafe account identifier.");
	}
	if (payload.lineItems !== undefined && !Array.isArray(payload.lineItems)) {
		throw new Error("Fireworks billing summary lineItems was not an array.");
	}

	const totals = new Map<string, Map<SeriesKey, bigint>>();
	for (const raw of payload.lineItems ?? []) {
		const lineItem = asObject(raw);
		if (!lineItem) throw new Error("Fireworks billing line item was not an object.");
		const cost = moneyAmount(lineItem.totalCost, "line item total cost");
		const series = seriesKey(lineItem.series);
		let amounts = totals.get(cost.currency);
		if (!amounts) {
			amounts = new Map<SeriesKey, bigint>();
			totals.set(cost.currency, amounts);
		}
		amounts.set(series, (amounts.get(series) ?? 0n) + cost.amount);
	}

	const metrics: UsageMetric[] = [];
	for (const [currency, amounts] of totals) {
		metrics.push({
			id: `${currency.toLowerCase()}-total`,
			label: "Total spend",
			value: formatMoneyAmount(sumSeries(amounts)),
			unit: "currency",
			currency,
		});
		for (const series of SERIES_KEYS) {
			const amount = amounts.get(series);
			if (amount === undefined) continue;
			metrics.push({
				id: `${currency.toLowerCase()}-${series}`,
				label: SERIES_LABELS[series],
				value: formatMoneyAmount(amount),
				unit: "currency",
				currency,
			});
		}
	}

	const notes = [
		"Rated line items may differ from the final invoice once credits or adjustments are applied.",
	];
	if (metrics.length === 0) {
		notes.push("Fireworks returned no rated line items for the last 30 days.");
	}

	return {
		providerId: "fireworks",
		providerName: "Fireworks",
		capturedAt,
		source: "fireworks-billing-summary",
		semantics: { kind: "api-key", label: "Fireworks API spend" },
		accountLabel: sanitizeDisplayText(accountId, 80),
		buckets: [],
		metrics,
		notes,
	};
}

type RatedMoney = { currency: string; amount: bigint };

function moneyAmount(value: unknown, description: string): RatedMoney {
	const money = asObject(value);
	if (!money) throw new Error(`Fireworks billing ${description} was not a money object.`);
	const currency = typeof money.currencyCode === "string" ? money.currencyCode : undefined;
	if (!currency || !CURRENCY_PATTERN.test(currency)) {
		throw new Error(`Fireworks billing ${description} currency was not an ISO 4217 code.`);
	}
	// proto3 JSON omits zero-valued money fields, so absent components default to zero.
	const units =
		money.units === undefined
			? 0n
			: integerComponent(money.units, description, "whole units", MAX_UNITS_CHARS);
	if (units < INT64_MIN || units > INT64_MAX) {
		throw new Error(`Fireworks billing ${description} whole units exceeded the int64 range.`);
	}
	const nanos =
		money.nanos === undefined
			? 0n
			: integerComponent(money.nanos, description, "nano units", MAX_NANOS_CHARS);
	if (nanos <= -NANOS_PER_UNIT || nanos >= NANOS_PER_UNIT) {
		throw new Error(`Fireworks billing ${description} nano units exceeded the Money range.`);
	}
	if ((units > 0n && nanos < 0n) || (units < 0n && nanos > 0n)) {
		throw new Error(`Fireworks billing ${description} mixed unit and nano signs.`);
	}
	return { currency, amount: units * NANOS_PER_UNIT + nanos };
}

function integerComponent(
	value: unknown,
	description: string,
	component: string,
	maxChars: number,
): bigint {
	const text =
		typeof value === "number" && Number.isSafeInteger(value)
			? String(value)
			: typeof value === "string" && INTEGER_PATTERN.test(value)
				? value
				: undefined;
	if (text === undefined || text.length > maxChars) {
		throw new Error(`Fireworks billing ${description} ${component} was not a bounded integer.`);
	}
	return BigInt(text);
}

function seriesKey(value: unknown): SeriesKey {
	if (value === undefined || value === null) return "other";
	if (typeof value !== "string") throw new Error("Fireworks billing line item series was invalid.");
	if (value === "SERVERLESS") return "serverless";
	if (value === "DEDICATED_DEPLOYMENT") return "dedicated";
	if (value === "TRAINING") return "training";
	return "other";
}

function sumSeries(amounts: ReadonlyMap<SeriesKey, bigint>): bigint {
	let total = 0n;
	for (const amount of amounts.values()) total += amount;
	return total;
}

function formatMoneyAmount(amount: bigint): string {
	const negative = amount < 0n;
	const magnitude = negative ? -amount : amount;
	const units = magnitude / NANOS_PER_UNIT;
	const nanos = (magnitude % NANOS_PER_UNIT).toString().padStart(9, "0").replace(/0+$/u, "");
	return `${negative ? "-" : ""}${units.toString()}${nanos ? `.${nanos}` : ""}`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}
