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
import type { UsageSettingsRuntime } from "./settings.js";

const OFF = "Off";
const ON = "On";

type UsageToggleSettingId = "codexFastMode" | "codexStatusResetCountdown";

export async function showUsageSettings(
	ctx: ExtensionCommandContext,
	settingsRuntime: UsageSettingsRuntime,
	parentSignal: AbortSignal,
	isCurrent: () => boolean,
	onApplied: (id: UsageToggleSettingId) => void,
): Promise<boolean> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify(`Edit settings manually: ${settingsRuntime.get().path}`, "info");
		return false;
	}
	if (parentSignal.aborted || !isCurrent()) return false;

	return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
		const localController = new AbortController();
		const signal = AbortSignal.any([parentSignal, localController.signal]);
		let changed = false;
		let closing = false;
		let saveQueue = Promise.resolve();
		const state = settingsRuntime.get();
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
		];
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold("pi-usage Settings")), 1, 1));

		let settingsList: SettingsList;
		const cancel = () => {
			if (closing) return;
			closing = true;
			localController.abort();
			done(changed);
		};
		settingsList = new SettingsList(
			items,
			items.length + 2,
			getSettingsListTheme(),
			(id, value) => {
				if (closing || signal.aborted || !isCurrent()) return;
				const settingId = id as UsageToggleSettingId;
				const requested = value !== OFF;
				saveQueue = saveQueue.then(async () => {
					const previous = settingsRuntime.get().settings[settingId];
					if (settingsRuntime.get().kind === "invalid") {
						settingsList.updateValue(id, displayValue(previous));
						if (!signal.aborted && isCurrent()) {
							ctx.ui.notify("Repair pi-usage.json and reload before changing settings.", "error");
							tui.requestRender();
						}
						return;
					}
					try {
						await settingsRuntime.update({ [settingId]: requested }, signal);
					} catch (error) {
						if (signal.aborted || !isCurrent()) return;
						settingsList.updateValue(id, displayValue(previous));
						ctx.ui.notify(`Could not save pi-usage.json: ${errorMessage(error)}`, "error");
						tui.requestRender();
						return;
					}
					if (previous !== requested) {
						changed = true;
						onApplied(settingId);
					}
					if (signal.aborted || !isCurrent()) return;
					settingsList.updateValue(id, displayValue(requested));
					tui.requestRender();
				});
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

function displayValue(enabled: boolean): string {
	return enabled ? ON : OFF;
}
