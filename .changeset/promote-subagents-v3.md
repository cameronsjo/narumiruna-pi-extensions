---
"@narumitw/pi-subagents": major
---

Replace the legacy orchestration runtime with subagent jobs and authenticated main-agent messaging.

Remove `/subagents`, extension settings, persisted and retained agents, the previous blocking orchestration interfaces, custom agent catalogs, advanced orchestration, alternate transports, trust-aware cwd policy, and extension-owned worktrees.

Use `subagent_spawn`, `subagent_inspect`, `subagent_cancel`, `subagent_wait`, and `subagent_reply` directly or through a user-designed skill after upgrading, and start a fresh Pi session so stored calls do not request removed tool names.

The package no longer registers or publishes a delegation skill, while the repository keeps `using-pi-subagents` as an example for designing one.

Completion messages follow Pi's global tool-output expansion state and configured `app.tools.expand` binding.
