---
"@narumitw/pi-subagents": major
---

Replace the legacy orchestration runtime with subagent jobs and authenticated main-agent messaging.

Remove `/subagents`, extension settings, persisted and retained agents, the previous blocking orchestration interfaces, custom agent catalogs, advanced orchestration, alternate transports, trust-aware cwd policy, and extension-owned worktrees.

Use the bundled `using-pi-subagents` skill with `subagent_spawn`, `subagent_inspect`, `subagent_cancel`, `subagent_wait`, and `subagent_reply` after upgrading, and start a fresh Pi session so stored calls do not request removed tool names.

Completion messages follow Pi's global tool-output expansion state and configured `app.tools.expand` binding.
