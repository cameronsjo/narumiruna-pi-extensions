import assert from "node:assert/strict";
import type { ExtensionCommandContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { createTuiHarness } from "@narumitw/pi-tui-kit/testing";
import { test, vi } from "vitest";
import type { TickerMenuOptions } from "../src/menu.js";
import { showTickerTuiMenu } from "../src/tui-menu.js";

const SHIFT_UP = "\u001b[1;2A";
const SHIFT_DOWN = "\u001b[1;2B";

function createOptions(initialSymbols: string[], initialWidgetEnabled = true) {
	let symbols = [...initialSymbols];
	let widgetEnabled = initialWidgetEnabled;
	const applied: string[][] = [];
	let refreshCount = 0;
	const controller = new AbortController();
	const options: TickerMenuOptions = {
		signal: controller.signal,
		isCurrent: () => !controller.signal.aborted,
		getSymbols: () => [...symbols],
		async applySymbols(next, signal) {
			signal.throwIfAborted();
			symbols = [...next];
			applied.push([...symbols]);
		},
		getWidgetEnabled: () => widgetEnabled,
		async applyWidgetEnabled(nextWidgetEnabled, signal) {
			signal.throwIfAborted();
			widgetEnabled = nextWidgetEnabled;
		},
		refresh() {
			refreshCount += 1;
		},
	};
	return {
		options,
		controller,
		applied,
		get symbols() {
			return symbols;
		},
		get widgetEnabled() {
			return widgetEnabled;
		},
		get refreshCount() {
			return refreshCount;
		},
	};
}

function context(
	tui: ReturnType<typeof createTuiHarness>,
	input: ExtensionCommandContext["ui"]["input"] = async () => undefined,
) {
	const notifications: Array<[string, string | undefined]> = [];
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			custom: tui.custom,
			input,
			notify(message: string, type?: string) {
				notifications.push([message, type]);
			},
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notifications };
}

test("rolls back widget visibility when persistence fails", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx, notifications } = context(tui);
	const state = createOptions(["NVDA"]);
	state.options.applyWidgetEnabled = async () => {
		throw new Error("disk unavailable");
	};
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.press("tui.select.down");
	tui.press("tui.select.down");
	tui.press("tui.select.confirm");
	await tui.waitForPending();

	assert.equal(state.widgetEnabled, true);
	assert.match(tui.render().join("\n"), /› Widget: On/);
	assert.match(notifications.at(-1)?.[0] ?? "", /settings were not saved: disk unavailable/);
	tui.press("ctrl+c");
	await running;
});

test("moves the focused ticker inline with Shift+Up and Shift+Down", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx } = context(tui);
	const state = createOptions(["NVDA", "AAPL", "NET"]);
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.press("tui.select.down");
	tui.send(SHIFT_DOWN);
	await tui.waitForPending();

	assert.deepEqual(state.symbols, ["NVDA", "NET", "AAPL"]);
	assert.deepEqual(state.applied, [["NVDA", "NET", "AAPL"]]);
	assert.match(tui.render().join("\n"), /› \[x\] AAPL/);
	assert.doesNotMatch(tui.render().join("\n"), /Reorder tickers/);

	tui.send(SHIFT_UP);
	await tui.waitForPending();
	assert.deepEqual(state.symbols, ["NVDA", "AAPL", "NET"]);
	tui.press("ctrl+c");
	await running;
});

test("rolls back inline reordering when persistence fails", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx, notifications } = context(tui);
	const state = createOptions(["NVDA", "AAPL"]);
	state.options.applySymbols = async () => {
		throw new Error("disk unavailable");
	};
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.send(SHIFT_DOWN);
	await tui.waitForPending();

	assert.deepEqual(state.symbols, ["NVDA", "AAPL"]);
	assert.match(tui.render().join("\n"), /disk unavailable/);
	assert.match(notifications.at(-1)?.[0] ?? "", /settings were not saved: disk unavailable/);
	tui.press("ctrl+c");
	await running;
});

test("keeps standard remapped navigation ahead of reorder shortcuts", async () => {
	const tui = createTuiHarness({
		width: 72,
		rows: 22,
		keybindings: shiftedNavigationKeybindings(),
	});
	const { ctx } = context(tui);
	const state = createOptions(["NVDA", "AAPL"]);
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.send(SHIFT_DOWN);

	assert.deepEqual(state.symbols, ["NVDA", "AAPL"]);
	assert.match(tui.render().join("\n"), /› \[x\] AAPL/);
	assert.doesNotMatch(tui.render().at(-1) ?? "", /move up|move down/);
	tui.press("ctrl+c");
	await running;
});

test("searches safely through the focused Input and disables reorder while filtered", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx } = context(tui);
	const state = createOptions(["NVDA", "AAPL", "NET"]);
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.setFocused(true);
	tui.send(`${"\u001b[200~"}\u001b[2Jaap${"\u001b[201~"}`);
	const frame = tui.render().join("\n");

	assert.match(frame, /AAPL/);
	assert.doesNotMatch(frame, /NVDA|NET/);
	assert.equal(frame.includes("\u001b[2J"), false);
	assert.equal(tui.focused, true);
	tui.send(SHIFT_DOWN);
	await tui.waitForPending();
	assert.deepEqual(state.symbols, ["NVDA", "AAPL", "NET"]);
	tui.send("\u007f");
	assert.match(tui.render().join("\n"), /> aa/);
	tui.press("tui.select.confirm");
	await tui.waitForPending();
	assert.deepEqual(state.symbols, ["NVDA", "NET"]);
	tui.press("ctrl+c");
	await running;
});

test("adds a valid unmatched search directly with Enter", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const input = vi.fn<ExtensionCommandContext["ui"]["input"]>(async () => undefined);
	const { ctx } = context(tui, input);
	const state = createOptions(["NVDA"]);
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.setFocused(true);
	tui.type("vti");
	assert.match(tui.render().join("\n"), /› Add VTI/);
	assert.doesNotMatch(tui.render().join("\n"), /Add custom ticker/);
	assert.match(tui.render().join("\n"), /Press Enter or Space to add VTI directly/);
	tui.press("tui.select.confirm");
	await tui.waitForPending();

	assert.deepEqual(state.symbols, ["NVDA", "VTI"]);
	assert.deepEqual(state.applied, [["NVDA", "VTI"]]);
	assert.equal(input.mock.calls.length, 0);
	assert.match(tui.render().join("\n"), /\[x\] VTI/);
	assert.doesNotMatch(tui.render().join("\n"), /> vti/);
	tui.press("ctrl+c");
	await running;
});

test("keeps an unmatched search available when direct-add persistence fails", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx, notifications } = context(tui);
	const state = createOptions(["NVDA"]);
	state.options.applySymbols = async () => {
		throw new Error("disk unavailable");
	};
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.setFocused(true);
	tui.type("vti");
	tui.press("tui.select.confirm");
	await tui.waitForPending();

	assert.deepEqual(state.symbols, ["NVDA"]);
	assert.match(tui.render().join("\n"), /> vti/);
	assert.match(notifications.at(-1)?.[0] ?? "", /settings were not saved: disk unavailable/);
	tui.press("ctrl+c");
	await running;
});

test("activates Refresh now without leaving the manager", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx } = context(tui);
	const state = createOptions(["NVDA"]);
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.press("tui.select.down");
	tui.press("tui.select.down");
	tui.press("tui.select.down");
	tui.press("tui.select.confirm");

	assert.equal(state.refreshCount, 1);
	assert.equal(tui.isOpen, true);
	tui.press("ctrl+c");
	await running;
});

test("hard-closes but drains an accepted inline reorder before returning", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx } = context(tui);
	const state = createOptions(["NVDA", "AAPL"]);
	const apply = state.options.applySymbols;
	let started!: () => void;
	const actionStarted = new Promise<void>((resolve) => {
		started = resolve;
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	state.options.applySymbols = async (symbols, signal) => {
		started();
		await gate;
		await apply(symbols, signal);
	};
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.send(SHIFT_DOWN);
	await actionStarted;
	tui.press("ctrl+c");
	assert.equal(tui.isOpen, false);

	let settled = false;
	void running.then(() => {
		settled = true;
	});
	await Promise.resolve();
	assert.equal(settled, false);
	release();
	await running;
	assert.deepEqual(state.symbols, ["AAPL", "NVDA"]);
});

test("aborts and drains pending inline reordering on session replacement", async () => {
	const tui = createTuiHarness({ width: 72, rows: 22 });
	const { ctx } = context(tui);
	const state = createOptions(["NVDA", "AAPL"]);
	let started!: () => void;
	const actionStarted = new Promise<void>((resolve) => {
		started = resolve;
	});
	let drained = false;
	state.options.applySymbols = async (_symbols, signal) => {
		started();
		if (!signal.aborted) {
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
		}
		drained = true;
	};
	const running = showTickerTuiMenu(ctx, state.options);
	await tui.waitForOpen();
	tui.send(SHIFT_DOWN);
	await actionStarted;
	state.controller.abort();
	await running;

	assert.equal(drained, true);
	assert.deepEqual(state.applied, []);
});

function shiftedNavigationKeybindings(): Pick<KeybindingsManager, "matches" | "getKeys"> {
	return {
		matches(data, binding) {
			switch (binding) {
				case "tui.select.up":
					return matchesKey(data, Key.shift(Key.up));
				case "tui.select.down":
					return matchesKey(data, Key.shift(Key.down));
				case "tui.select.pageUp":
					return matchesKey(data, Key.pageUp);
				case "tui.select.pageDown":
					return matchesKey(data, Key.pageDown);
				case "tui.select.confirm":
					return matchesKey(data, Key.enter);
				case "tui.select.cancel":
					return matchesKey(data, Key.escape);
				default:
					return false;
			}
		},
		getKeys(binding) {
			switch (binding) {
				case "tui.select.up":
					return ["shift+up"];
				case "tui.select.down":
					return ["shift+down"];
				case "tui.select.pageUp":
					return ["pageUp"];
				case "tui.select.pageDown":
					return ["pageDown"];
				case "tui.select.confirm":
					return ["enter"];
				case "tui.select.cancel":
					return ["escape"];
				default:
					return [];
			}
		},
	};
}
