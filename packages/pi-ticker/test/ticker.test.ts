import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { createRpcHarness } from "@narumitw/pi-tui-kit/testing";
import { afterEach, test, vi } from "vitest";
import stockTicker, {
	POLL_INTERVAL_MS,
	SETTINGS_FILE_NAME,
	settingsPath,
	WIDGET_KEY,
} from "../src/ticker.js";

interface Command {
	handler: (argumentsText: string, ctx: ExtensionContext) => Promise<void>;
	getArgumentCompletions: (prefix: string) => unknown;
}

type Handler = (event: never, ctx: ExtensionContext) => unknown;
type WidgetFactory = (_tui: never, theme: Theme) => Component;
type WidgetRecord = [string, string[] | WidgetFactory | undefined, unknown?];

const temporaryDirectories: string[] = [];

const identityTheme = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function createHarness() {
	const handlers = new Map<string, Handler[]>();
	let command: Command | undefined;
	let commandName: string | undefined;
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(name: string, registered: Command) {
			commandName = name;
			command = registered;
		},
	} as unknown as ExtensionAPI;
	stockTicker(pi);
	return {
		get command(): Command {
			assert.ok(command);
			return command;
		},
		get commandName(): string | undefined {
			return commandName;
		},
		async emit(event: string, ctx: ExtensionContext) {
			for (const handler of handlers.get(event) ?? []) await handler({} as never, ctx);
		},
	};
}

async function createContext(mode: ExtensionContext["mode"] = "tui") {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stock-ticker-context-"));
	temporaryDirectories.push(cwd);
	vi.stubEnv("PI_CODING_AGENT_DIR", cwd);
	const widgets: WidgetRecord[] = [];
	const notifications: Array<[string, string | undefined]> = [];
	const sessionManager = {} as ExtensionContext["sessionManager"];
	const ctx = {
		cwd,
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		sessionManager,
		ui: {
			setWidget(key: string, content: string[] | WidgetFactory | undefined, options?: unknown) {
				widgets.push([key, content, options]);
			},
			notify(message: string, type?: string) {
				notifications.push([message, type]);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, cwd, widgets, notifications };
}

function successfulResponse(input: string | URL | Request): Promise<Response> {
	const symbol = decodeURIComponent(String(input).split("/").at(-1)?.split("?")[0] ?? "UNKNOWN");
	return Promise.resolve(
		new Response(
			JSON.stringify({
				chart: {
					result: [
						{
							meta: {
								regularMarketPrice: 110,
								previousClose: 100,
								currency: "USD",
								symbol,
							},
						},
					],
				},
			}),
		),
	);
}

function render(record: WidgetRecord | undefined, width = 80): string[] | undefined {
	if (!record) return undefined;
	const content = record[1];
	return typeof content === "function"
		? content(undefined as never, identityTheme).render(width)
		: content;
}

test("registers the ticker command and uses user-scoped settings", () => {
	vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/pi-ticker-agent");
	const harness = createHarness();
	assert.equal(harness.commandName, "ticker");
	assert.equal(POLL_INTERVAL_MS, 30_000);
	assert.equal(SETTINGS_FILE_NAME, "pi-ticker.json");
	assert.equal(settingsPath(), join("/tmp/pi-ticker-agent", SETTINGS_FILE_NAME));
});

test("starts empty without polling or showing a widget", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const current = await createContext();

	await harness.emit("session_start", current.ctx);
	assert.equal(fetchMock.mock.calls.length, 0);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);

	await harness.emit("session_shutdown", current.ctx);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
});

test("ignores project-local ticker settings", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const current = await createContext();
	const projectSettingsPath = join(current.cwd, ".pi", SETTINGS_FILE_NAME);
	await mkdir(join(current.cwd, ".pi"), { recursive: true });
	await writeFile(projectSettingsPath, '{"symbols":["NVDA"]}\n');

	await harness.emit("session_start", current.ctx);
	assert.equal(fetchMock.mock.calls.length, 0);
	assert.equal(await readFile(projectSettingsPath, "utf8"), '{"symbols":["NVDA"]}\n');
	await harness.emit("session_shutdown", current.ctx);
});

test("keeps a persisted disabled widget hidden and blocks manual refresh", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const current = await createContext();
	await writeFile(
		join(current.cwd, SETTINGS_FILE_NAME),
		'{"symbols":["NVDA"],"widgetEnabled":false}\n',
	);

	await harness.emit("session_start", current.ctx);
	assert.equal(fetchMock.mock.calls.length, 0);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
	await harness.command.handler("refresh", current.ctx);
	assert.equal(fetchMock.mock.calls.length, 0);
	assert.match(current.notifications.at(-1)?.[0] ?? "", /disabled/);
	await harness.emit("session_shutdown", current.ctx);
});

test("enables a persisted widget immediately through the RPC menu", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const current = await createContext("rpc");
	await writeFile(
		join(current.cwd, SETTINGS_FILE_NAME),
		'{"symbols":["NVDA"],"widgetEnabled":false}\n',
	);
	const rpc = createRpcHarness([
		{ kind: "select", response: "Widget: Off" },
		{ kind: "select", response: "Close" },
	]);
	Object.assign(current.ctx.ui, rpc.ui);

	await harness.emit("session_start", current.ctx);
	await harness.command.handler("", current.ctx);
	await vi.waitFor(() => assert.equal(fetchMock.mock.calls.length, 1));
	const settings = JSON.parse(await readFile(join(current.cwd, SETTINGS_FILE_NAME), "utf8")) as {
		widgetEnabled: boolean;
	};
	assert.equal(settings.widgetEnabled, true);
	await vi.waitFor(() =>
		assert.match(render(current.widgets.at(-1))?.join("\n") ?? "", /NVDA \$110\.00/),
	);
	rpc.assertConsumed();
	await harness.emit("session_shutdown", current.ctx);
});

test("disables and hides an active widget immediately through the RPC menu", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const current = await createContext("rpc");
	await writeFile(
		join(current.cwd, SETTINGS_FILE_NAME),
		'{"symbols":["NVDA"],"widgetEnabled":true}\n',
	);
	const rpc = createRpcHarness([
		{ kind: "select", response: "Widget: On" },
		{ kind: "select", response: "Close" },
	]);
	Object.assign(current.ctx.ui, rpc.ui);

	await harness.emit("session_start", current.ctx);
	await vi.waitFor(() => assert.equal(fetchMock.mock.calls.length, 1));
	await harness.command.handler("", current.ctx);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
	const settings = JSON.parse(await readFile(join(current.cwd, SETTINGS_FILE_NAME), "utf8")) as {
		widgetEnabled: boolean;
	};
	assert.equal(settings.widgetEnabled, false);
	rpc.assertConsumed();
	await harness.emit("session_shutdown", current.ctx);
});

test("uses plain RPC widgets and rejects commands without a UI", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const rpc = await createContext("rpc");
	await writeFile(join(rpc.cwd, SETTINGS_FILE_NAME), '{"symbols":["NVDA"]}\n');

	await harness.emit("session_start", rpc.ctx);
	await vi.waitFor(() => assert.equal(fetchMock.mock.calls.length, 1));
	await vi.waitFor(() =>
		assert.match(render(rpc.widgets.at(-1))?.join("\n") ?? "", /NVDA \$110\.00/),
	);
	assert.ok(Array.isArray(rpc.widgets.at(-1)?.[1]));
	await harness.command.handler("help", rpc.ctx);
	assert.match(rpc.notifications.at(-1)?.[0] ?? "", /Usage: \/ticker/);
	await harness.emit("session_shutdown", rpc.ctx);

	fetchMock.mockClear();
	const json = await createContext("json");
	await harness.emit("session_start", json.ctx);
	assert.equal(fetchMock.mock.calls.length, 0);
	assert.equal(json.widgets.length, 0);
	await assert.rejects(harness.command.handler("help", json.ctx), /requires TUI or RPC mode/);
	await assert.rejects(harness.command.handler("NVDA", json.ctx), /requires TUI or RPC mode/);
	assert.equal(json.notifications.length, 0);
	await assert.rejects(readFile(join(json.cwd, SETTINGS_FILE_NAME)), { code: "ENOENT" });
	await harness.emit("session_shutdown", json.ctx);
});

test("opens the Kit menu for bare commands and drains it during shutdown", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const current = await createContext("rpc");
	const rpc = createRpcHarness([{ kind: "select", waitForAbort: true }]);
	Object.assign(current.ctx.ui, rpc.ui);

	await harness.emit("session_start", current.ctx);
	const running = harness.command.handler("", current.ctx);
	await rpc.waitForCall();
	await harness.emit("session_shutdown", current.ctx);
	await running;

	rpc.assertConsumed();
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
});

test("ignores stale session shutdown and persists command symbol changes", async () => {
	const fetchMock = vi.fn(successfulResponse);
	vi.stubGlobal("fetch", fetchMock);
	const harness = createHarness();
	const previous = await createContext();
	const current = await createContext();

	await harness.emit("session_start", previous.ctx);
	await harness.emit("session_start", current.ctx);
	const currentWidgetCount = current.widgets.length;
	await harness.emit("session_shutdown", previous.ctx);
	assert.equal(current.widgets.length, currentWidgetCount);

	await harness.command.handler("msft spy", current.ctx);
	const settings = JSON.parse(await readFile(join(current.cwd, SETTINGS_FILE_NAME), "utf8")) as {
		symbols: string[];
	};
	assert.deepEqual(settings.symbols, ["MSFT", "SPY"]);
	assert.match(current.notifications.at(-1)?.[0] ?? "", /MSFT SPY/);
	assert.equal(harness.command.getArgumentCompletions("ref") !== null, true);

	await harness.command.handler("reset", current.ctx);
	assert.match(current.notifications.at(-1)?.[0] ?? "", /No default ticker list/);
	await harness.command.handler("refresh now", current.ctx);
	assert.match(current.notifications.at(-1)?.[0] ?? "", /trailing arguments/);
	await harness.emit("session_shutdown", current.ctx);
	assert.deepEqual(current.widgets.at(-1), [WIDGET_KEY, undefined, undefined]);
});
