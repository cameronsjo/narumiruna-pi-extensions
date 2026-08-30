import {
	type ExtensionCommandContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import { errorMessage } from "./core.js";
import { isFireworksAccountId } from "./providers/fireworks.js";
import type { UsageSettings, UsageSettingsRuntime } from "./settings.js";

const AUTO = "Auto";
const EDIT = "Edit…";
const OFF = "Off";
const ON = "On";

type UsageSettingId = keyof UsageSettings;
type SettingsScreenResult = { changed: boolean; editFireworksAccount: boolean };

export async function showUsageSettings(
	ctx: ExtensionCommandContext,
	settingsRuntime: UsageSettingsRuntime,
	parentSignal: AbortSignal,
	isCurrent: () => boolean,
	onApplied: (id: UsageSettingId) => void,
): Promise<boolean> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify(`Edit settings manually: ${settingsRuntime.get().path}`, "info");
		return false;
	}
	let changed = false;
	while (!parentSignal.aborted && isCurrent()) {
		const result = await showSettingsList(ctx, settingsRuntime, parentSignal, isCurrent, onApplied);
		if (!result) return changed;
		changed ||= result.changed;
		if (!result.editFireworksAccount) return changed;
		changed ||= await editFireworksAccount(
			ctx,
			settingsRuntime,
			parentSignal,
			isCurrent,
			onApplied,
		);
	}
	return changed;
}

async function showSettingsList(
	ctx: ExtensionCommandContext,
	settingsRuntime: UsageSettingsRuntime,
	parentSignal: AbortSignal,
	isCurrent: () => boolean,
	onApplied: (id: UsageSettingId) => void,
): Promise<SettingsScreenResult | undefined> {
	return ctx.ui.custom<SettingsScreenResult>((tui, theme, _keybindings, done) => {
		const localController = new AbortController();
		const signal = AbortSignal.any([parentSignal, localController.signal]);
		let changed = false;
		let closing = false;
		let saveQueue = Promise.resolve();
		const state = settingsRuntime.get();
		const fireworksValue = state.settings.fireworksAccountId ?? AUTO;
		const items: SettingItem[] = [
			{
				id: "codexFastMode",
				label: "Codex Fast mode",
				description: "Use faster Codex routing at increased plan allowance consumption.",
				currentValue: state.settings.codexFastMode ? ON : OFF,
				values: [OFF, ON],
			},
			{
				id: "codexStatusResetCountdown",
				label: "Codex reset countdown",
				description: "Show time remaining until each Codex usage limit resets.",
				currentValue: state.settings.codexStatusResetCountdown ? ON : OFF,
				values: [OFF, ON],
			},
			{
				id: "fireworksAccountId",
				label: "Fireworks account",
				description: "Select Edit to enter a visible account slug, or submit blank to clear it.",
				currentValue: fireworksValue,
				values: state.settings.fireworksAccountId
					? [state.settings.fireworksAccountId, EDIT]
					: [AUTO, EDIT],
			},
		];
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold("pi-usage Settings")), 1, 1));

		let settingsList: SettingsList;
		const cancel = () => {
			if (closing) return;
			closing = true;
			localController.abort();
			done({ changed, editFireworksAccount: false });
		};
		const queueUpdate = (
			id: UsageSettingId,
			requested: UsageSettings[UsageSettingId],
			display: string,
		) => {
			saveQueue = saveQueue.then(async () => {
				const previous = settingsRuntime.get().settings[id];
				if (settingsRuntime.get().kind === "invalid") {
					settingsList.updateValue(id, displaySetting(id, previous));
					if (!signal.aborted && isCurrent()) {
						ctx.ui.notify("Repair pi-usage.json and reload before changing settings.", "error");
						tui.requestRender();
					}
					return;
				}
				try {
					await settingsRuntime.update({ [id]: requested }, signal);
				} catch (error) {
					if (signal.aborted || !isCurrent()) return;
					settingsList.updateValue(id, displaySetting(id, previous));
					ctx.ui.notify(`Could not save pi-usage.json: ${errorMessage(error)}`, "error");
					tui.requestRender();
					return;
				}
				if (previous !== requested) {
					changed = true;
					onApplied(id);
				}
				if (signal.aborted || !isCurrent()) return;
				settingsList.updateValue(id, display);
				tui.requestRender();
			});
		};
		settingsList = new SettingsList(
			items,
			items.length + 2,
			getSettingsListTheme(),
			(id, value) => {
				if (closing || signal.aborted || !isCurrent()) return;
				if (id === "fireworksAccountId") {
					if (value === EDIT) {
						saveQueue = saveQueue.then(() => {
							if (closing || signal.aborted || !isCurrent()) return;
							closing = true;
							done({ changed, editFireworksAccount: true });
						});
					}
					return;
				}
				const settingId = id as "codexFastMode" | "codexStatusResetCountdown";
				queueUpdate(settingId, value !== OFF, value);
			},
			cancel,
		);
		container.addChild(settingsList);

		parentSignal.addEventListener("abort", cancel, { once: true });
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data: string) {
				if (closing) return;
				if (matchesKey(data, Key.ctrl("c"))) cancel();
				else settingsList.handleInput(data);
				tui.requestRender();
			},
			dispose() {
				localController.abort();
				parentSignal.removeEventListener("abort", cancel);
			},
		};
	});
}

async function editFireworksAccount(
	ctx: ExtensionCommandContext,
	settingsRuntime: UsageSettingsRuntime,
	signal: AbortSignal,
	isCurrent: () => boolean,
	onApplied: (id: UsageSettingId) => void,
): Promise<boolean> {
	while (!signal.aborted && isCurrent()) {
		const state = settingsRuntime.get();
		if (state.kind === "invalid") {
			ctx.ui.notify("Repair pi-usage.json and reload before changing settings.", "error");
			return false;
		}
		const entered = await ctx.ui.input(
			"Fireworks account slug · submit blank for Auto",
			state.settings.fireworksAccountId ?? "Example: acme",
			{ signal },
		);
		if (signal.aborted || !isCurrent() || entered === undefined) return false;
		const normalized = entered.trim();
		const requested = normalized || undefined;
		if (requested !== undefined && !isFireworksAccountId(requested)) {
			ctx.ui.notify("Enter a URL-safe Fireworks account slug.", "warning");
			continue;
		}
		if (requested === state.settings.fireworksAccountId) return false;
		try {
			await settingsRuntime.update({ fireworksAccountId: requested }, signal);
		} catch (error) {
			if (signal.aborted || !isCurrent()) return false;
			ctx.ui.notify(`Could not save pi-usage.json: ${errorMessage(error)}`, "error");
			return false;
		}
		onApplied("fireworksAccountId");
		return true;
	}
	return false;
}

function displaySetting(id: UsageSettingId, value: UsageSettings[UsageSettingId]): string {
	if (id === "fireworksAccountId") return typeof value === "string" ? value : AUTO;
	return value ? ON : OFF;
}
