# 🐑 pi-herdr — Herdr Integration for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-herdr)](https://www.npmjs.com/package/@narumitw/pi-herdr) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Connect Pi's interactive lifecycle to Herdr and bundle the operating guidance needed to control Herdr safely.

## ✨ Features

- Reports Pi session identity and `working`, `blocked`, and `idle` lifecycle states to the current Herdr pane.
- Shows recognized sibling agents from the current Herdr workspace in a passive widget above Pi's editor.
- Updates the widget from Herdr pane lifecycle and agent-status events without polling the CLI.
- Coalesces rapid state changes and retries short-lived local socket failures without interrupting Pi.
- Derives blocked state from Pi's public `ui_prompt_start` and `ui_prompt_end` lifecycle events.
- Bundles the `herdr` skill for explicit Herdr inspection and control requests.
- Keeps extension and skill installation in one Pi package.

## 📦 Install

Install persistently from npm:

```bash
pi install npm:@narumitw/pi-herdr
```

Try from npm without installing permanently:

```bash
pi -e npm:@narumitw/pi-herdr
```

Load a local checkout from the repository root:

```bash
pi --no-extensions -e ./packages/pi-herdr
```

Pi extensions and skills run with your user permissions.
Install only trusted packages, and review the source and bundled instructions before loading this package.

## 🚀 Quick start

Start Pi inside a Herdr-managed pane after installing the package.
The extension activates automatically when `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` are present.
When the current Herdr workspace contains another recognized agent, Pi shows its state in a widget above the editor.
Ask Pi to use Herdr, or invoke `/skill:herdr`, when you want it to inspect or control the current Herdr session.

If the standalone integration and skill are already installed, remove them after installing this package to avoid duplicate state reports and skill-name collisions:

```bash
rm ~/.pi/agent/extensions/herdr-agent-state.ts
rm -rf ~/.agents/skills/herdr
```

Run `/reload` or restart Pi after changing the installed resources.

## 🔄 Lifecycle reporting

The extension reports only interactive TUI sessions because Herdr displays agents attached to terminal panes.
A session report contains the Herdr pane ID, the integration source, Pi's agent kind, a monotonic sequence, the session start reason, and an absolute Pi session path when available.
It falls back to Pi's session ID when no absolute session path is available.
Agent reports contain the same ownership fields plus the current lifecycle state and optional blocked label.
Blocking extension prompts use their Pi-provided title as the label and fall back to the prompt kind.

Local socket delivery is best-effort.
A failed request is retried once with bounded timeouts, and reporting failures never stop Pi.
Session shutdown aborts in-flight reporting and prevents stale session work from publishing later state.

## 🐑 Agent widget

The widget lists only recognized agents in the current Herdr workspace and excludes the pane running the current Pi session.
Each row presents state, agent, pane, and workspace in that order, using theme hierarchy instead of repeating field labels.
Agent identity prefers the name assigned by `herdr agent rename`, then Herdr display metadata, and finally the detected agent kind.
Pane identity uses its label or metadata title with a short pane ID, while workspace identity uses its label with a short workspace ID.
Terminal titles are not used as agent identity.
The widget orders agents by `blocked`, `done`, `working`, `idle`, and `unknown`, shows at most five rows, and reports any remaining count.
A state label published through Herdr metadata can replace the raw state name.
Herdr's public pane responses do not expose the blocked prompt message, so the widget cannot show that reason.
The widget is read-only and does not focus panes, read terminal output, send prompts, or mark a background `done` state as seen.
The extension discovers the current workspace, pane list, and agent names, opens pane-scoped status subscriptions plus topology subscriptions, and then reloads those identities to reconcile changes made during initialization.
Expected pane creation, movement, or agent detection rebuilds the pane-scoped subscriptions without consuming the bounded failure retry.
Unexpected disconnection clears the widget before one bounded reconnect attempt, and a second failure leaves it hidden until the next Pi session or `/reload`.
Session replacement and shutdown abort the subscription, pending requests, reconnect delay, and stale widget publication.

## 🔒 Security and privacy

The extension connects only to the Unix socket or Windows named pipe provided by `HERDR_SOCKET_PATH`.
It sends the current Herdr pane ID, Pi session path or ID, lifecycle state, session start reason, and blocked label to that endpoint.
For the widget, it reads the canonical current pane, current workspace metadata, current workspace pane list, and session agent list, then subscribes to pane creation, closure, movement, exit, agent detection, and agent-status events.
The session agent list can contain agent metadata from other workspaces, but the extension retains names only for panes in the current workspace list.
Widget fields can include workspace, tab, pane, terminal, agent, display, name, title, label, state-label, and lifecycle identifiers supplied by Herdr.
The subscription can deliver matching pane events from other workspaces in the same Herdr session, and the extension ignores them after resolving the current workspace.
The extension filters presentation to the current workspace, strips terminal controls at the display boundary, and never reads sibling terminal output for the widget.
The package does not authenticate the endpoint, so trust the environment that launches Pi and controls these variables.

The bundled skill can direct Pi to inspect terminals, create panes, start agents, send input, and run commands through the local `herdr` CLI.
Those commands execute with the same user permissions as Pi and can affect live terminal sessions.
The skill requires an explicit user request involving Herdr and stops when `HERDR_ENV` is not `1`.

## 🚧 Limitations

- State reporting and the agent widget are disabled in RPC, JSON, and print modes.
- The widget has no settings for placement, workspace scope, visibility, or row count.
- The widget cannot show blocked prompt text because Herdr does not expose it through public pane responses.
- Herdr exposes no rename event, so agent and pane renames appear after the next topology refresh, reconnect, Pi `/reload`, or session start rather than immediately.
- Integration requires a running compatible Herdr session and valid injected environment variables.
- Socket failures are intentionally silent after the bounded retry.
- The package does not install, start, update, or configure Herdr itself.

## 🗂️ Package layout

```text
packages/pi-herdr/
├── skills/herdr/
│   └── SKILL.md              # Herdr control workflow and safety rules
├── src/
│   ├── index.ts              # Thin Pi entrypoint
│   ├── herdr-agent-state.ts  # Pi lifecycle and integration ownership
│   ├── herdr-client.ts       # Bounded Herdr socket transport
│   ├── herdr-observer.ts     # Read-only event subscription lifecycle
│   ├── herdr-protocol.ts     # Narrow response and event validation
│   └── herdr-widget.ts       # Agent state model and presentation
├── test/
│   ├── herdr-agent-state.test.ts
│   ├── herdr-client.test.ts
│   ├── herdr-observer.test.ts
│   └── herdr-widget.test.ts
├── package.json              # Pi extension and skill declarations
├── tsconfig.json
├── README.md
└── LICENSE
```

## 🔎 Keywords

Pi, Herdr, terminal multiplexer, coding agents, agent orchestration, lifecycle state.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
