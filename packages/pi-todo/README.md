# ✅ pi-todo — Keep Multi-Step Work Visible

[![npm](https://img.shields.io/npm/v/@narumitw/pi-todo)](https://www.npmjs.com/package/@narumitw/pi-todo)
[![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Pi Todo gives the model a focused list for tracking multi-step work above Pi's editor.

The list follows the active session branch and disappears when no tracked work remains or the session ends.

## ✨ Features

- Registers one `update_todo_list` tool for meaningful multi-step work.
- Keeps task text concise and action-oriented, with at most one task in progress.
- Shows a compact themed task list and completion count above the editor in TUI mode.
- Restores the latest valid list when Pi starts a session or navigates between branches.
- Restores the exact current list to model context only when compaction removes its latest visible successful tool update.
- Sanitizes terminal and bidirectional controls before rendering model-provided text.
- Works without settings, files, network access, or external services.

## 📦 Install

Install persistently from npm:

```bash
pi install npm:@narumitw/pi-todo
```

Try from npm without installing permanently:

```bash
pi -e npm:@narumitw/pi-todo
```

Build and load this package directly from a repository checkout:

```bash
npm --workspace @narumitw/pi-todo run build
pi --no-extensions -e ./packages/pi-todo
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

Pi extensions run with the user's permissions, so install only trusted code.

## 🚀 Quick start

Ask Pi to perform work with multiple meaningful steps.

The model can use `update_todo_list` to create a concise list, mark one task `in_progress`, and revise the plan as work changes.

Each update replaces the complete list, and an empty list clears it.

Tool guidance tells the model to update changed statuses promptly and reconcile the list before progress reports or the final response.

## 🛠️ Tools

### `update_todo_list`

Replaces the complete todo list for the active session.

Each item has this shape:

```json
{
  "text": "Run the focused tests",
  "status": "in_progress"
}
```

Accepted statuses are `pending`, `in_progress`, and `completed`.

A list may contain up to 50 items, each item may contain up to 300 characters, and at most one item may be `in_progress`.

### Session and compaction behavior

Each successful tool result stores a versioned snapshot on the active session branch.

Session startup and branch navigation reconstruct the latest valid list from those results.

Reconstruction also accepts valid results stored under the former `todo_widget` name, but new calls use only `update_todo_list`.

During ordinary turns, the persisted assistant tool call and successful result keep the complete current list visible to the model without rewriting prompt history.

If leading compaction or branch summaries remove that matching pair, the extension inserts one hidden, non-persistent state message immediately after the summaries.

The restored message stays fixed for that leading-summary epoch, even after a later valid update or clear.

Branch-local boundary metadata preserves the established prefix across reload and branch navigation without persisting the hidden message as model context.

A later tool call and result supersede the restored state at the conversation tail without rewriting the earlier provider prefix.

An ordinary context without a leading summary receives no fallback.

A new summary epoch restores only the list that is current when restoration becomes necessary.

In TUI mode, updates appear immediately above the editor.

The widget shows completed and total task counts, followed by themed completed, in-progress, and pending rows.

Long task text wraps to the terminal width, with continuation lines aligned beneath the text.

In RPC, print, and JSON modes, the tool still returns structured details but does not create a visual widget.

## 🔒 Security and privacy

The extension does not read or write files, start processes, access credentials, or make network requests.

Pi stores task text in normal session tool results, so it follows the user's session persistence choices.

Terminal escape sequences, control characters, and bidirectional display controls are removed at the rendering boundary without changing the stored tool payload.

## 🚧 Limitations

- The visual widget appears above the editor only in TUI mode.
- The extension provides a model tool rather than a slash command or manual task editor.
- The extension reminds the model to update statuses but cannot infer task completion or force a tool call.
- Branch reconstruction uses only valid versioned `update_todo_list` or legacy `todo_widget` tool results on the active branch.
- The widget has no independent scrolling or height-based collapsing, so Pi may clip later rows when terminal height is constrained.

## 🗂️ Package layout

```text
packages/pi-todo/
├── dist/
│   └── index.ts              # Generated Jiti runtime entrypoint
├── scripts/
│   └── build-runtime.mjs     # Deterministic runtime builder and validator
├── src/
│   ├── index.ts              # Thin extension entrypoint
│   └── todo-widget.ts        # Tool, lifecycle, state reconstruction, and rendering
├── test/
│   ├── build-runtime.test.ts       # Build, boundary, and Jiti loader coverage
│   ├── todo-cache-contract.test.ts # Normalized provider-prefix coverage
│   └── todo-widget.test.ts         # Extension behavior coverage
├── LICENSE
├── README.md
├── package.json
└── tsconfig.json
```

The package exposes its Pi extension through `package.json`:

```json
{
  "pi": {
    "extensions": ["./dist/index.ts"]
  }
}
```

## 🔎 Keywords

Pi extension, coding agent, todo list, task progress, session widget, TypeScript Pi package.

## 📄 License

[MIT](./LICENSE)
