# 🧩 Pi Subagents — Subagent Jobs with Main-Agent Messaging

[![npm](https://img.shields.io/npm/v/@narumitw/pi-subagents)](https://www.npmjs.com/package/@narumitw/pi-subagents) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Pi Subagents starts Pi subagent jobs and lets each child ask the main agent necessary questions through an authenticated loopback broker.

A bundled `using-pi-subagents` skill owns delegation strategy, least-privilege tool selection, parallel-work guidance, timeout selection, question handling, result review, and writer safety.

## ✨ Features

- Starts one isolated Pi child process per job.
- Lets each task define the child's assignment and each effective tool list define its capabilities.
- Loads optional user-defined role prompts and execution defaults from Pi's user directory.
- Provides a `/subagents` TUI manager to create, edit, rename, and delete profiles.
- Defaults child work tools to `read`, `grep`, `find`, and `ls`.
- Inherits the main agent's effective model and defaults to its thinking level.
- Gives every child fixed `subagent_ask` and `subagent_wait` communication tools.
- Lets the main agent answer a pending child question with `subagent_reply`.
- Interrupts a parent job wait when a question needs a main-agent response without cancelling the job.
- Publishes one guarded asynchronous completion and releases child resources at terminal state.
- Shows each active job's state, elapsed time, timeout, and selected work tools above the editor.
- Exposes privacy-filtered job metadata without leaking task text, output, prompts, selected tools, or broker credentials.
- Cancels active session-owned work and closes the loopback broker during replacement, reload, or shutdown.

## 📦 Install

The version 3 runtime is not published to npm yet.

The npm package remains on the legacy 2.x runtime and does not provide the tools documented below.

Install the repository source as one Pi package:

```bash
pi install git:github.com/narumiruna/pi-extensions
```

This Git installation enables every stable extension listed in the repository root manifest, including Pi Subagents.

To install only Pi Subagents, clone the repository, install dependencies, build its generated runtime, and install its package directory:

```bash
git clone https://github.com/narumiruna/pi-extensions.git
cd pi-extensions
npm install
npm --workspace @narumitw/pi-subagents run build
pi install ./packages/pi-subagents
```

Build before trying the extension and bundled skill from a local checkout:

```bash
npm --workspace @narumitw/pi-subagents run build
pi --no-extensions -e ./packages/pi-subagents
```

The package entry is generated at `dist/index.ts` and loaded through Pi's Jiti runtime.

An unbuilt local package directory cannot load its declared extension entry.

Pi extensions and children with `bash`, `powershell`, `edit`, or `write` execute with your user permissions.

Review the source before installing or invoking the extension.

## 🚀 Quick start

Ask Pi to use the bundled `using-pi-subagents` skill when deciding whether to delegate, or invoke `/skill:using-pi-subagents` directly.

Run `/subagents` in Pi TUI mode to manage optional named profiles.

Start one subagent job with `subagent_spawn`.

The tool returns a `jobId` immediately.

The job runs in the background while the main agent continues useful work until a completion arrives or the result is required.

Completion messages follow Pi's global tool-output expansion state and `app.tools.expand` binding (`Ctrl+O` by default).

If `subagent_wait` reports `reason: "subagent_message"`, answer the visible question with `subagent_reply`, then wait for the job again when needed.

In TUI mode, an above-editor widget shows one compact line for each queued or running job.

Each line includes the job ID, current state, elapsed execution time, configured timeout or `no timeout`, and selected work tools.

The fixed `subagent_ask` and child `subagent_wait` communication tools are omitted from the widget because every child receives them.

The widget disappears when no jobs remain active and is cleared during session replacement, reload, or shutdown.

## 💬 Commands

`/subagents` opens the TUI profile manager and accepts no arguments.

The menu lists profiles and provides Create, Task prompt, Tools, Timeout, Thinking level, Rename, Delete, Status, and Help flows.

Tool changes save immediately, while Delete requires an exact confirmation summary.

The command rejects print and JSON modes and reports an observable unsupported-mode warning in RPC mode.

## 🛠️ Tools

The main Pi session exposes five fixed tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent_spawn` | `task`, optional `role`, `tools`, `thinkingLevel`, `timeout` | Start one subagent job and return its `jobId`. |
| `subagent_inspect` | none | List privacy-filtered retained-job metadata. |
| `subagent_cancel` | `jobId` | Idempotently cancel one queued or running job. |
| `subagent_wait` | `jobId`, optional `timeout` | Wait for a job or return early for a pending child question. |
| `subagent_reply` | `requestId`, `message` | Answer one pending child question without replacing an accepted reply. |

Every child exposes these communication tools in addition to its selected work tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent_ask` | `message` | Send one question to the main agent and return a `requestId`. |
| `subagent_wait` | `requestId`, optional `timeout` | Wait for the main agent's plain-text reply. |

Execution and wait timeouts use seconds and accept finite numbers greater than zero through 2,147,483.647.

An omitted job execution timeout uses the selected profile value, or no timeout when no profile is selected.

An unprofiled job without an execution timeout runs until it exits, is cancelled, the session shuts down, or the Pi process exits.

Wait timeouts have no default.

A wait timeout or caller cancellation stops only that wait and does not cancel its job or question request.

Tasks, questions, and replies are limited to 50 KiB of UTF-8 text.

Replies are also limited to 2,000 lines so successful child tool output stays within Pi's tool-result bound.

Each job may have up to four unanswered or not-yet-consumed question requests.

The terminal states are `completed`, `partial`, `failed`, `timed_out`, and `cancelled`.

`subagent_inspect` never returns complete task text, child output, prompts, selected tools, context, credentials, environment variables, questions, replies, or secrets.

See [`docs/tools.md`](./docs/tools.md) for the concise schema reference.

## ⚙️ Settings

Role profiles are optional named child prompts and execution defaults stored in `<getAgentDir()>/pi-subagents.json`, normally `~/.pi/agent/pi-subagents.json`.

The file is a top-level JSON object keyed by lowercase kebab-case role names of at most 64 characters.

Each selected profile requires `task`, `tools`, `timeout`, and `thinkingLevel`.

Unknown fields inside otherwise valid profiles are preserved when the manager changes an owned field.

Profile tasks are limited to 50 KiB of UTF-8 text, and profile tool lists accept the same names and limits as explicit spawn tools.

A profile timeout and thinking level accept the same values as their explicit spawn counterparts.

Example:

```json
{
  "reviewer": {
    "task": "Review independently without editing files and return findings with exact evidence.",
    "tools": ["read", "grep", "find", "ls"],
    "timeout": 300,
    "thinkingLevel": "high"
  }
}
```

Pass the profile name through `role`:

```json
{
  "role": "reviewer",
  "task": "Review packages/pi-subagents."
}
```

The profile `task` is appended to the child system prompt, while the spawn `task` remains the assignment.

Profile `tools`, `timeout`, and `thinkingLevel` values are defaults.

Explicit spawn arguments override those defaults.

Create starts with a generic task prompt, `read`, `grep`, `find`, and `ls`, a 300-second timeout, and the current effective thinking level.

An omitted, empty, or whitespace-only `role` does not read the file and preserves the ordinary spawn behavior.

A selected spawn reads the file again, so saved changes apply to the next profiled job without `/reload`.

The `/subagents` manager creates this file only after an explicit Create action and reloads the latest valid document before every mutation.

Manager writes use a private temporary file and atomic rename, and successful publications use mode `0600` on POSIX.

Malformed JSON or any invalid profile blocks every manager mutation instead of being overwritten.

Manager operations are ordered within one Pi process because each small settings mutation completes synchronously.

Separate Pi processes have no merge lock, so simultaneous valid writes may replace one another even though readers never see partial JSON.

The extension does not load project overrides.

A missing file, invalid JSON, unknown role, or invalid profile fails before a selected job is queued.

The spawn task defines the child's objective, scope, constraints, and expected result.

The effective `tools` list defines what the child can do.

Accepted names are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`.

Unavailable or extension-only tool names are rejected before a job is queued.

Omitting `tools` uses the selected profile list, or `read`, `grep`, `find`, and `ls` when no profile is selected.

Passing an explicit empty list overrides a profile and gives the child no work tools.

The runtime always adds `subagent_ask` and child `subagent_wait` and removes duplicate names.

Adding `edit` or `write` lets the child modify files.

Adding `bash` or `powershell` grants unrestricted command execution and can also modify the workspace.

The optional `thinkingLevel` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

Omitting `thinkingLevel` uses the selected profile level, or captures the main agent's effective level when no profile is selected.

The child inherits the main agent's effective provider and model when `subagent_spawn` executes.

Spawn rejects providers registered by a parent extension because children disable unrelated extensions.

Spawn also rejects process-local runtime API keys such as a parent-only `--api-key` value.

Use stored or environment credentials that child processes can read.

The extension does not expose a per-job model override.

## 🔄 Messaging, lifecycle, and retention

The session starts one TCP broker on `127.0.0.1` with an operating-system-assigned ephemeral port.

Each job receives one cryptographically random token bound to its job identity and session generation.

The parent passes the broker credentials once through a private inherited pipe instead of placing them in the child's initial environment or command line.

The child bridge reads and closes that descriptor before model tool execution.

Each child communication tool call uses one request-scoped connection, while a response wait uses an abortable long poll.

The first accepted `subagent_reply` wins, and repeated replies acknowledge the existing answer without replacing it.

A child may retry `subagent_wait` after a wait timeout because the underlying request remains active.

A new job starts as `queued`, transitions to `running`, and reaches exactly one terminal state.

The runtime retains up to 32 recent terminal records for up to 24 hours within the current extension session.

Inspection reports older records removed by retention bounds through `omitted.jobs`.

Cancelling or terminalizing a job revokes its token and rejects pending child waits before stale output can replace the terminal state.

Session replacement and shutdown cancel active work, suppress stale completion delivery, revoke credentials, close sockets, and stop the broker.

## 🔀 Migrating from 2.x

Version 3.0 replaces the previous orchestration runtime and does not migrate its settings, persisted jobs, retained conversations, or recovery state.

Finish or record any required work before upgrading, then start a fresh Pi session so stored calls do not request removed tool names.

Use these replacements where the new job model supports the previous intent:

| Previous interface | Version 3 interface |
| --- | --- |
| `subagent` or `subagent_spawn` | `subagent_spawn` |
| `subagent_await` | `subagent_wait` |
| `subagent_inspect` | `subagent_inspect` |
| `subagent_manage` cancellation | `subagent_cancel` |
| Child-to-main questions | Child `subagent_ask` and `subagent_wait`, plus main `subagent_reply` |

The legacy `/subagents` job-control interface, persisted custom agent catalogs, `subagent_send`, `subagent_mailbox`, `subagent_consult`, retained follow-ups, advanced orchestration, alternate transports, trust-aware cwd policy, and extension-owned worktrees are not migrated.

The new `/subagents` command manages only version 3 user profiles.

Recreate any needed named prompts and execution defaults through the new manager or manually in `pi-subagents.json`.

Describe each job's assignment in the spawn `task` and grant only the required work tools through the profile or explicit `tools`.

## 🔒 Security and privacy

The selected work tools run in the current working directory.

The default list is read-only by capability because it contains no shell or file-mutation tool.

This default is not a filesystem sandbox because the allowed read tools can inspect files available to the user account.

Selecting `bash`, `powershell`, `edit`, or `write` permits workspace mutation with the Pi process environment and user permissions.

Every child disables session persistence, unrelated extensions, skills, and prompt templates.

A selected role adds only its validated local `task` string to that child's system prompt.

The runtime passes that string through a private temporary prompt file so path-like text remains literal, then removes the file after the child settles.

Role profiles are trusted user configuration rather than a security boundary, and selecting a profile can enable its configured work tools.

The profile manager validates every profile before writing and never repairs malformed settings by replacing them with defaults.

Do not store credentials or other secrets in profile tasks or extra fields.

Provider selection therefore supports Pi's child-visible built-in and configured providers, not providers registered only by a parent extension.

Credentials must be available independently to the child through Pi's stored credentials or its inherited environment.

The broker accepts only loopback TCP connections with an active per-job token.

The token is bootstrapped through a private inherited pipe and is absent from the child's initial environment and command line.

A child question is visible model context, but its envelope explicitly identifies it as untrusted subagent content rather than user authorization.

A child question cannot grant permission for writes, shell commands, credential access, or other privileged actions.

Terminal controls and bidirectional controls are stripped before untrusted child text is displayed.

Tasks, repository context, questions, and inspected file content may be sent to the selected model provider.

Parallel writers require disjoint ownership or workspace isolation outside this extension.

## 🚧 Limitations

The extension does not load arbitrary extension tools or parent-registered model providers into child processes.

Process-local runtime API keys are not forwarded to children.

The extension does not provide bundled agents, project profiles, per-job models, arbitrary per-call system prompts, peer-to-peer child messaging, retained conversations, user-directed follow-up work, mailboxes, Agent Teams, chains, fan-in aggregators, panels, workflow DAGs, dynamic scheduling, verification orchestration, nested subagents, cross-process settings locking, or extension-owned semantic memory.

Child questions use request-response coordination, not a retained conversational session.

The main agent must verify child claims against the actual diff and deterministic checks.

Questions trigger a main-agent turn, but asynchronous job completions do not wake an otherwise idle model turn automatically.

Jobs, broker requests, and retained results do not survive extension reload, session replacement, or process exit.

## 🗂️ Package layout

```text
packages/pi-subagents/
├── dist/                        # Generated Jiti runtime and child bridge
├── docs/                        # Concise tools and design references
├── scripts/                     # Deterministic runtime builder
├── src/                         # Extension, broker, child bridge, and subprocess runtime
├── skills/using-pi-subagents/  # Delegation and messaging operating manual
├── test/                        # Protocol, lifecycle, process, and policy tests
├── package.json                 # Pi extension and skill declarations
└── README.md                    # User guide and safety boundaries
```

## 🔎 Keywords

Pi, subagents, delegation, subagent jobs, least privilege, main-agent messaging, cancellation, job lifecycle.

## 📄 License

[MIT](./LICENSE)
