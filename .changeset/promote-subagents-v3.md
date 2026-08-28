---
"@narumitw/pi-subagents": major
---

Replace the legacy orchestration runtime with background jobs and authenticated main-agent messaging.

Remove `/subagents`, extension settings, persisted and retained agents, the previous blocking and underscore-named tools, custom agent catalogs, advanced orchestration, alternate transports, trust-aware cwd policy, and extension-owned worktrees.

Use the bundled `using-pi-subagents` skill with `subagent-spawn`, `subagent-inspect`, `subagent-cancel`, `subagent-wait`, and `subagent-reply` after upgrading, and start a fresh Pi session so stored calls do not request removed tool names.
