# 🐑 pi-herdr — Herdr Integration for Pi

[![npm](https://img.shields.io/npm/v/@narumitw/pi-herdr)](https://www.npmjs.com/package/@narumitw/pi-herdr) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Connect Pi's interactive lifecycle to Herdr and bundle the operating guidance needed to control Herdr safely.

## ✨ Features

- Reports Pi session identity and `working`, `blocked`, and `idle` lifecycle states to the current Herdr pane.
- Coalesces rapid state changes and retries short-lived local socket failures without interrupting Pi.
- Listens for `herdr:blocked` events from approval or question integrations.
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

Local socket delivery is best-effort.
A failed request is retried once with bounded timeouts, and reporting failures never stop Pi.
Session shutdown aborts in-flight reporting and prevents stale session work from publishing later state.

## 🔒 Security and privacy

The extension connects only to the Unix socket or Windows named pipe provided by `HERDR_SOCKET_PATH`.
It sends the current Herdr pane ID, Pi session path or ID, lifecycle state, session start reason, and blocked label to that endpoint.
The package does not authenticate the endpoint, so trust the environment that launches Pi and controls these variables.

The bundled skill can direct Pi to inspect terminals, create panes, start agents, send input, and run commands through the local `herdr` CLI.
Those commands execute with the same user permissions as Pi and can affect live terminal sessions.
The skill requires an explicit user request involving Herdr and stops when `HERDR_ENV` is not `1`.

## 🚧 Limitations

- State reporting is disabled in RPC, JSON, and print modes.
- State reporting requires a running Herdr session and valid injected environment variables.
- Socket failures are intentionally silent after the bounded retry.
- The package does not install, start, update, or configure Herdr itself.

## 🗂️ Package layout

```text
packages/pi-herdr/
├── skills/herdr/
│   └── SKILL.md              # Herdr control workflow and safety rules
├── src/
│   ├── index.ts              # Thin Pi entrypoint
│   └── herdr-agent-state.ts  # Herdr socket and Pi lifecycle integration
├── test/
│   └── herdr-agent-state.test.ts
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
