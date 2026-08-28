import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCompletionRenderer } from "./completion-renderer.js";
import { registerSubagentsCommand } from "./menu.js";
import { registerSubagentTools, type SubagentToolsDependencies } from "./tools.js";
import { createSubagentWidgetController } from "./widget.js";

export type SubagentsDependencies = SubagentToolsDependencies;

export default function subagents(
	pi: ExtensionAPI,
	dependencies: SubagentsDependencies = {},
): void {
	registerCompletionRenderer(pi);
	const tools = registerSubagentTools(pi, dependencies);
	const widget = createSubagentWidgetController(tools.runtime);
	let activeSession: ExtensionContext["sessionManager"] | undefined;
	let sessionGeneration = 0;
	let menuController: AbortController | undefined;

	registerSubagentsCommand(pi, {
		getOwner: (ctx) => {
			const controller = menuController;
			const session = ctx.sessionManager;
			const generation = sessionGeneration;
			if (!controller || session !== activeSession) return undefined;
			return {
				signal: controller.signal,
				isCurrent: () =>
					!controller.signal.aborted &&
					generation === sessionGeneration &&
					session === activeSession,
			};
		},
		getActiveJobs: () => tools.runtime.activeJobsForDisplay(),
	});

	pi.on("session_start", async (_event, ctx) => {
		menuController?.abort(new DOMException("Subagents session replaced", "AbortError"));
		const controller = new AbortController();
		menuController = controller;
		activeSession = ctx.sessionManager;
		const generation = ++sessionGeneration;
		await tools.startSession();
		if (generation !== sessionGeneration || controller.signal.aborted) return;
		widget.start(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.sessionManager !== activeSession) return;
		sessionGeneration++;
		activeSession = undefined;
		menuController?.abort(new DOMException("Subagents session stopped", "AbortError"));
		menuController = undefined;
		widget.shutdown(ctx);
		await tools.shutdown();
	});
}
