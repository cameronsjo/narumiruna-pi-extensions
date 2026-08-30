import type { Theme } from "@earendil-works/pi-coding-agent";
import { EditorStatusWidget } from "@narumitw/pi-tui-kit/editor-status-widget";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit/terminal-text";
import type { HerdrAgentStatus, HerdrPane, HerdrPaneEvent } from "./herdr-protocol.js";

export const HERDR_WIDGET_KEY = "herdr:agents";
export const MAX_HERDR_WIDGET_AGENTS = 5;

interface ObservedPane {
	paneId: string;
	workspaceId: string;
	agent?: string;
	agentStatus: HerdrAgentStatus;
	displayAgent?: string;
	label?: string;
	stateLabels: Record<string, string>;
	terminalTitle?: string;
	title?: string;
}

export interface HerdrWidgetRow {
	name: string;
	paneId: string;
	state: HerdrAgentStatus;
	stateLabel: string;
}

export interface HerdrWidgetSnapshot {
	totalAgents: number;
	hiddenAgents: number;
	rows: readonly HerdrWidgetRow[];
}

const STATE_ORDER: Record<HerdrAgentStatus, number> = {
	blocked: 0,
	done: 1,
	working: 2,
	idle: 3,
	unknown: 4,
};

function observedPane(pane: HerdrPane): ObservedPane {
	return {
		paneId: pane.paneId,
		workspaceId: pane.workspaceId,
		agent: pane.agent,
		agentStatus: pane.agentStatus,
		displayAgent: pane.displayAgent,
		label: pane.label,
		stateLabels: { ...pane.stateLabels },
		terminalTitle: pane.terminalTitle,
		title: pane.title,
	};
}

function safeDisplay(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const safe = sanitizeTerminalText(value).trim();
	return safe.length > 0 ? safe : undefined;
}

function displayName(pane: ObservedPane): string {
	return (
		safeDisplay(pane.label) ??
		safeDisplay(pane.title) ??
		safeDisplay(pane.displayAgent) ??
		safeDisplay(pane.terminalTitle) ??
		safeDisplay(pane.agent) ??
		safeDisplay(pane.paneId) ??
		"agent"
	);
}

function rowForPane(pane: ObservedPane): HerdrWidgetRow {
	return {
		name: displayName(pane),
		paneId: safeDisplay(pane.paneId) ?? "pane",
		state: pane.agentStatus,
		stateLabel:
			safeDisplay(pane.stateLabels[pane.agentStatus]) ?? safeDisplay(pane.agentStatus) ?? "unknown",
	};
}

function immutableSnapshot(rows: HerdrWidgetRow[]): HerdrWidgetSnapshot | undefined {
	if (rows.length === 0) return undefined;
	const visible = rows.slice(0, MAX_HERDR_WIDGET_AGENTS).map((row) => Object.freeze({ ...row }));
	return Object.freeze({
		totalAgents: rows.length,
		hiddenAgents: Math.max(0, rows.length - visible.length),
		rows: Object.freeze(visible),
	});
}

export class HerdrWidgetModel {
	private currentPaneId: string | undefined;
	private currentWorkspaceId: string | undefined;
	private panes = new Map<string, ObservedPane>();

	reset(currentPane: HerdrPane, panes: readonly HerdrPane[]): void {
		this.currentPaneId = currentPane.paneId;
		this.currentWorkspaceId = currentPane.workspaceId;
		this.panes = new Map(panes.map((pane) => [pane.paneId, observedPane(pane)]));
	}

	clear(): void {
		this.currentPaneId = undefined;
		this.currentWorkspaceId = undefined;
		this.panes.clear();
	}

	isCurrentPane(paneId: string): boolean {
		return this.currentPaneId === paneId;
	}

	isCurrentWorkspace(workspaceId: string): boolean {
		return this.currentWorkspaceId === workspaceId;
	}

	apply(event: HerdrPaneEvent): void {
		if (event.type === "created") {
			this.panes.set(event.pane.paneId, observedPane(event.pane));
			return;
		}
		if (event.type === "closed" || event.type === "exited") {
			this.panes.delete(event.paneId);
			return;
		}
		if (event.type === "moved") {
			this.panes.delete(event.previousPaneId);
			this.panes.set(event.pane.paneId, observedPane(event.pane));
			if (this.currentPaneId === event.previousPaneId) {
				this.currentPaneId = event.pane.paneId;
				this.currentWorkspaceId = event.pane.workspaceId;
			}
			return;
		}

		const existing = this.panes.get(event.paneId);
		if (event.type === "agent_detected") {
			if (event.released || !event.agent) {
				if (existing) this.panes.set(event.paneId, { ...existing, agent: undefined });
				return;
			}
			this.panes.set(event.paneId, {
				...(existing ?? {
					paneId: event.paneId,
					workspaceId: event.workspaceId,
					agentStatus: event.finalStatus ?? "unknown",
					stateLabels: {},
				}),
				agent: event.agent,
				agentStatus: event.finalStatus ?? existing?.agentStatus ?? "unknown",
			});
			return;
		}
		if (event.type !== "agent_status_changed") return;

		this.panes.set(event.paneId, {
			...(existing ?? {
				paneId: event.paneId,
				workspaceId: event.workspaceId,
				stateLabels: {},
			}),
			agent: event.agent ?? existing?.agent,
			agentStatus: event.agentStatus,
			displayAgent: event.displayAgent ?? existing?.displayAgent,
			stateLabels: event.stateLabels ?? existing?.stateLabels ?? {},
			title: event.title ?? existing?.title,
		});
	}

	snapshot(): HerdrWidgetSnapshot | undefined {
		if (!this.currentPaneId || !this.currentWorkspaceId) return undefined;
		const rows = [...this.panes.values()]
			.filter(
				(pane) =>
					pane.workspaceId === this.currentWorkspaceId &&
					pane.paneId !== this.currentPaneId &&
					pane.agent !== undefined,
			)
			.map(rowForPane);
		const duplicateNames = new Map<string, number>();
		for (const row of rows) duplicateNames.set(row.name, (duplicateNames.get(row.name) ?? 0) + 1);
		for (const row of rows) {
			if ((duplicateNames.get(row.name) ?? 0) > 1) row.name = `${row.name} · ${row.paneId}`;
		}
		rows.sort(
			(left, right) =>
				STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
				left.name.localeCompare(right.name) ||
				left.paneId.localeCompare(right.paneId),
		);
		return immutableSnapshot(rows);
	}
}

function stateStyle(theme: Theme, state: HerdrAgentStatus, text: string): string {
	switch (state) {
		case "blocked":
			return theme.fg("warning", text);
		case "done":
			return theme.fg("success", text);
		case "working":
			return theme.fg("accent", text);
		case "idle":
			return theme.fg("muted", text);
		case "unknown":
			return theme.fg("dim", text);
	}
}

function stateSymbol(state: HerdrAgentStatus): string {
	switch (state) {
		case "blocked":
			return "!";
		case "done":
			return "✓";
		case "working":
			return "●";
		case "idle":
			return "○";
		case "unknown":
			return "?";
	}
}

export function createHerdrWidget(snapshot: HerdrWidgetSnapshot, theme: Theme): EditorStatusWidget {
	return new EditorStatusWidget({
		theme,
		renderBody() {
			const noun = snapshot.totalAgents === 1 ? "agent" : "agents";
			const lines = [theme.fg("muted", `Herdr · ${snapshot.totalAgents} sibling ${noun}`)];
			for (const row of snapshot.rows) {
				const state = stateStyle(theme, row.state, `${stateSymbol(row.state)} ${row.stateLabel}`);
				lines.push(`${state}  ${theme.fg("text", row.name)}  ${theme.fg("dim", row.paneId)}`);
			}
			if (snapshot.hiddenAgents > 0) {
				lines.push(theme.fg("dim", `+${snapshot.hiddenAgents} more`));
			}
			return lines;
		},
	});
}

export function herdrWidgetFingerprint(
	snapshot: HerdrWidgetSnapshot | undefined,
): string | undefined {
	return snapshot ? JSON.stringify(snapshot) : undefined;
}
