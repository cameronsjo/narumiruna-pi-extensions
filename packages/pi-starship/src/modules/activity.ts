import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";
import { defineModule } from "./types.js";

const MAX_UI_PROMPT_TITLE_WIDTH = 40;
const EMPTY_PROMPT_VALUES = { kind: "", title: "" } as const;

function formatUIPromptTitle(title: string | undefined): string {
	const safeTitle = title ? sanitizeTerminalText(title).trim() : "";
	if (visibleWidth(safeTitle) <= MAX_UI_PROMPT_TITLE_WIDTH) return safeTitle;
	return `${sliceByColumn(safeTitle, 0, MAX_UI_PROMPT_TITLE_WIDTH - 1, true)}…`;
}

export const activityModule = defineModule({
	name: "activity",
	variables: ["symbol", "state", "tool", "count", "kind", "title", "text"],
	defaults: {
		format: "[ $text ]($style)",
		symbol: "⚙",
		style: "bold yellow",
		disabled: false,
	},
	values: ({ runtime, symbol }) => {
		if (runtime.uiPrompt) {
			const title = formatUIPromptTitle(runtime.uiPrompt.title);
			const waiting = `waiting for ${runtime.uiPrompt.kind}${title ? ` · ${title}` : ""}`;
			return {
				state: "waiting",
				tool: "",
				count: "0",
				kind: runtime.uiPrompt.kind,
				title,
				text: `${symbol} ${waiting}`,
			};
		}

		const active = [...runtime.activeTools.entries()];
		if (active.length > 0) {
			const [tool = "tool", count = 1] = active[0] ?? [];
			const suffix = count > 1 ? `×${count}` : "";
			const more = active.length > 1 ? `+${active.length - 1}` : "";
			return {
				state: "active",
				tool,
				count: `${count}`,
				...EMPTY_PROMPT_VALUES,
				text: `${symbol} ${tool}${suffix}${more}`,
			};
		}
		if (runtime.isStreaming) {
			return {
				state: "thinking",
				tool: "",
				count: "0",
				...EMPTY_PROMPT_VALUES,
				text: `${symbol} thinking`,
			};
		}
		if (runtime.lastCompletedTool) {
			return {
				state: "completed",
				tool: runtime.lastCompletedTool,
				count: "0",
				...EMPTY_PROMPT_VALUES,
				text: `${symbol} completed ${runtime.lastCompletedTool}`,
			};
		}
		return {
			state: "idle",
			tool: "",
			count: "0",
			...EMPTY_PROMPT_VALUES,
			text: `${symbol} idle`,
		};
	},
});
