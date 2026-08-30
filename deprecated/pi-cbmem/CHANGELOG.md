# @narumitw/pi-cbmem

## 0.1.0

### Minor Changes

- 523d268: Add safe `@current` resolution for exact current indexes and matching clean canonical worktree graphs.
  
  Keep borrowed graph access read-only, revalidate it around each call, and read borrowed snippets from the current worktree.
- ef9b7fd: Detect the account-scoped Codebase Memory daemon at Pi session startup and start a permanent daemon when none is active.
  
  Replace per-tool one-shot CLI processes with one persistent MCP stdio session per Pi session, and verify that its child is committed to the active daemon before tools become ready.
  
  Cancel individual MCP requests without closing unrelated work, and close stale or shut-down session children without stopping the persistent daemon.

### Patch Changes

- Updated dependencies [fc6fab5]
- Updated dependencies [636fd3c]
  - @narumitw/pi-tui-kit@0.60.0

## 0.0.1

### Patch Changes

- 18876fd: Correct the public package metadata and npm installation guidance.
