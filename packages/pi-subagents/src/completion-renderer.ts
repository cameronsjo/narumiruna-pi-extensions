import { type ExtensionAPI, getMarkdownTheme, keyText } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "./message-broker.js";

export const COMPLETION_MESSAGE_TYPE = "pi-subagents-completion";

export function registerCompletionRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(COMPLETION_MESSAGE_TYPE, (message, options, theme) => {
		const box = new Box(options.outputPad, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(
			new Text(theme.fg("customMessageLabel", theme.bold(`[${COMPLETION_MESSAGE_TYPE}]`)), 0, 0),
		);
		box.addChild(new Spacer(1));
		if (!options.expanded) {
			box.addChild(
				new Text(
					theme.fg("customMessageText", "Subagent job completion (") +
						theme.fg("dim", keyText("app.tools.expand")) +
						theme.fg("customMessageText", " to expand)"),
					0,
					0,
				),
			);
			return box;
		}
		const content =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n");
		box.addChild(
			new Markdown(sanitizeTerminalText(content), 0, 0, getMarkdownTheme(), {
				color: (text) => theme.fg("customMessageText", text),
			}),
		);
		return box;
	});
}
