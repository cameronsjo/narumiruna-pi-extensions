---
"@narumitw/pi-cbmem": minor
---

Detect the account-scoped Codebase Memory daemon at Pi session startup and start a permanent daemon when none is active.

Replace per-tool one-shot CLI processes with one persistent MCP stdio session per Pi session, and verify that its child is committed to the active daemon before tools become ready.

Cancel individual MCP requests without closing unrelated work, and close stale or shut-down session children without stopping the persistent daemon.
