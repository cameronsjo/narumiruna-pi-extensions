# 📈 pi-ticker — Show Market Quotes Above Pi's Editor

[![npm](https://img.shields.io/npm/v/@narumitw/pi-ticker)](https://www.npmjs.com/package/@narumitw/pi-ticker) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Show configurable Yahoo Finance market quotes in a width-aware widget above Pi's editor.

## ✨ Features

- Shows price, daily change, and daily percentage change for up to ten symbols.
- Starts empty and performs no quote requests until at least one symbol is added.
- Packs complete ticker entries into rows that fit the current terminal width.
- Provides searchable TUI and RPC menus for adding, removing, and reordering symbols.
- Persists widget visibility and the ordered symbol list in user settings.
- Refreshes every 30 seconds while enabled and marks the last successful quote stale after a partial failure.
- Cancels polling, in-flight requests, and active menus during reload, session replacement, and shutdown.

## 📦 Install

Install from npm:

```bash
pi install npm:@narumitw/pi-ticker
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-ticker
```

Load this package from a local checkout:

```bash
pi --no-extensions -e ./packages/pi-ticker
```

Extensions run with Pi's permissions, so install only trusted packages.

## 🚀 Quick start

Run Pi in TUI mode and open the ticker manager:

```text
/ticker
```

Choose **Add custom ticker…** and enter a Yahoo Finance symbol such as `MSFT`, `SPY`, or `BTC-USD`.

The widget appears after the settings save and the first quote request completes.

## 🧭 Ticker manager

`/ticker` opens **Manage tickers** in TUI and RPC modes.

TUI mode keeps search, symbol removal, direct add, widget visibility, and refresh actions on one screen.

Enter or Space activates the focused row.

An unmatched valid search changes the add row to **Add SYMBOL** so the symbol can be added directly.

`Shift+Up` and `Shift+Down` reorder the focused ticker when the search field is empty and those keys do not conflict with configured standard bindings.

RPC mode exposes portable dialogs for choosing and moving a ticker.

Every accepted change saves immediately, and a failed save restores the previous displayed and effective value.

Removing the final ticker hides the widget and stops polling.

Escape closes transient TUI flows, and `Ctrl+C` remains a hard-close path.

## 💬 Commands

- `/ticker` opens the ticker manager.
- `/ticker <SYMBOL ...>` replaces the ordered symbol list and refreshes quotes.
- `/ticker refresh` refreshes quotes immediately when the widget is enabled.
- `/ticker help` shows direct-command usage.
- `/ticker reset` reports that no default symbol list exists and leaves settings unchanged.

Known routes reject trailing arguments.

All command routes support TUI and RPC modes.

Print and JSON modes reject the command before changing settings.

## ⚙️ Settings

The canonical user settings file is:

```text
<getAgentDir()>/pi-ticker.json
```

The normal path is `~/.pi/agent/pi-ticker.json`.

Pi's configured agent directory replaces `~/.pi/agent` when applicable.

Ticker preferences are user-scoped and apply across projects.

The extension does not read project settings or extension-specific environment-variable overrides.

A missing file uses an empty symbol list, keeps the widget enabled, and does not create the file, its parent directory, or a polling task.

The file must contain a JSON object with these optional fields:

| Field | Accepted values | Default | Behavior |
| --- | --- | --- | --- |
| `symbols` | Zero to ten Yahoo Finance symbol strings | `[]` | Controls the ordered quotes shown in the widget. |
| `widgetEnabled` | boolean | `true` | Controls widget visibility and quote polling. |

Each symbol may contain up to 15 uppercase letters, digits, `.`, `^`, `=`, or `-`.

Lowercase command and menu input is normalized to uppercase.

Example:

```json
{
  "symbols": ["NVDA", "BTC-USD", "ETH-USD"],
  "widgetEnabled": true
}
```

Unknown JSON fields are preserved during saves.

Malformed or invalid settings are reported, ignored at runtime, and never overwritten by the extension.

Writes are ordered within one Pi process and published through a temporary file plus atomic rename.

Separate Pi processes do not share a cross-process lock.

Settings reload on startup and `/reload`.

## 🔒 Security and privacy

The extension requests public chart metadata from Yahoo Finance over HTTPS without an API key.

Requested ticker symbols and the host network address are visible to Yahoo Finance.

The user settings file contains only ticker symbols and widget visibility; it stores no credential or secret.

Ticker symbols and quote data are shown locally and are not added to model context by this extension.

## 🚧 Limitations

Yahoo Finance is an unofficial dependency and may rate-limit, delay, change, or remove the endpoint.

Quotes may be delayed and are not suitable for trading decisions.

Each request times out after 10 seconds, and one symbol failure does not discard successful symbols.

The polling queue is owned by one Pi session and is not shared across Pi processes.

## 🗂️ Package layout

```text
packages/pi-ticker/
├── src/
│   ├── index.ts       # Thin Pi package entrypoint
│   ├── ticker.ts      # Registration, commands, polling, and lifecycle ownership
│   ├── menu.ts        # Mode dispatch and RPC management flow
│   ├── tui-menu.ts    # Searchable TUI manager and reorder shortcuts
│   ├── settings.ts    # Validation and atomic user-settings persistence
│   ├── quotes.ts      # Yahoo Finance requests and response parsing
│   └── render.ts      # Width-bounded plain and themed widget rendering
├── test/              # Deterministic package behavior tests
├── README.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## 🔎 Keywords

Pi extension, market quotes, stock ticker, Yahoo Finance, editor widget, terminal UI, TypeScript.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
