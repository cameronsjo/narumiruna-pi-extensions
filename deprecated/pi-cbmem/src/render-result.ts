import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";

interface RenderTheme {
	fg(color: "toolOutput" | "warning", text: string): string;
}

export function renderCodebaseMemoryResult(
	result: AgentToolResult<unknown>,
	options: ToolRenderResultOptions,
	theme: RenderTheme,
): Text {
	const rawText = result.content
		.flatMap((content) => (content.type === "text" ? [content.text] : []))
		.join("\n");
	const displayText = sanitizeMultilineTerminalText(rawText);
	const color = options.isPartial ? "warning" : "toolOutput";
	return new Text(theme.fg(color, displayText), 0, 0);
}

function sanitizeMultilineTerminalText(value: string): string {
	return value
		.replace(/\r\n?/gu, "\n")
		.split("\n")
		.map((line) => sanitizeTerminalText(line))
		.join("\n");
}
