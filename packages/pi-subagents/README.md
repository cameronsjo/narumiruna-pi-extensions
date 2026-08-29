# 🧩 Pi Subagents — Subagent Jobs with Main-Agent Messaging

[![npm](https://img.shields.io/npm/v/@narumitw/pi-subagents)](https://www.npmjs.com/package/@narumitw/pi-subagents) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Pi Subagents runs Pi jobs in separate child processes and lets each child ask the main agent necessary questions through an authenticated loopback broker.

## ✨ Features

- Runs each job in an isolated Pi child process and returns its job ID immediately.
- Uses the task to define the child's specialization and the tool list to limit its capabilities.
- Defaults work tools to `read`, `grep`, `find`, and `ls`.
- Inherits the main agent's effective model and uses its thinking level by default.
- Gives every child fixed `subagent_ask` and `subagent_wait` tools for necessary questions.
- Lets the main agent answer with `subagent_reply` without cancelling the job.
- Publishes one asynchronous terminal completion and shows active-job progress above the editor.
- Exposes privacy-filtered metadata without task text, output, prompts, selected tools, or broker credentials.
- Cancels session-owned work and closes the broker during replacement, reload, or shutdown.

## 📦 Install

The version 3 runtime documented here is not yet published to npm.

The npm package still contains the legacy 2.x runtime and does not provide the tools below.

Install the repository source as one Pi package:

```bash
pi install git:github.com/narumiruna/pi-extensions
```

This Git installation enables every extension listed in the repository root manifest, including Pi Subagents.

To install only Pi Subagents, clone the repository, install dependencies, build its generated runtime, and install its package directory:

```bash
git clone https://github.com/narumiruna/pi-extensions.git
cd pi-extensions
npm install
npm --workspace @narumitw/pi-subagents run build
pi install ./packages/pi-subagents
```

Build before trying the extension from a local checkout:

```bash
npm --workspace @narumitw/pi-subagents run build
pi --no-extensions -e ./packages/pi-subagents
```

The package entry is generated at `dist/index.ts` and loaded through Pi's Jiti runtime.

An unbuilt local package directory cannot load its declared extension entry.

Pi extensions and children with `bash`, `powershell`, `edit`, or `write` execute with your user permissions.

Review the source before installing or invoking the extension.

## 🚀 Quick start

Call `subagent_spawn` with a self-contained task and only the work tools that task needs.

The package intentionally does not register or publish a skill.

Create a project skill under `.pi/skills/<your-skill>/SKILL.md` or a global skill under `~/.pi/agent/skills/<your-skill>/SKILL.md` when you want reusable delegation policy.

Choose a name, trigger description, tool policy, task format, and verification workflow for your own use case.

The repository-only [`using-pi-subagents` example](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-subagents/skills/using-pi-subagents) demonstrates one possible design without imposing it on installed users.

The call returns a `jobId` immediately, and the job continues in the background.

Continue useful main-agent work until the result is required or a completion arrives.

If `subagent_wait` returns `reason: "subagent_message"`, answer the visible question with `subagent_reply` and wait for the job again only when needed.

Completion messages follow Pi's global tool-output expansion state and the `app.tools.expand` binding (`Ctrl+O` by default).

In TUI mode, the above-editor widget shows each queued or running job's ID, state, elapsed time, timeout, and selected work tools.

The widget omits the fixed communication tools, disappears when no jobs remain active, and clears when the session ends.

## 🛠️ Tools

The main Pi session exposes five fixed tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent_spawn` | `task`, optional `tools`, `thinkingLevel`, `timeout` | Start one subagent job and return its `jobId`. |
| `subagent_inspect` | none | List privacy-filtered retained-job metadata. |
| `subagent_cancel` | `jobId` | Idempotently cancel one queued or running job. |
| `subagent_wait` | `jobId`, optional `timeout` | Wait for a job or return early for a pending child question. |
| `subagent_reply` | `requestId`, `message` | Answer one pending child question without replacing an accepted reply. |

Every child exposes these communication tools in addition to its selected work tools:

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `subagent_ask` | `message` | Send one question to the main agent and return a `requestId`. |
| `subagent_wait` | `requestId`, optional `timeout` | Wait for the main agent's plain-text reply. |

Execution and wait timeouts use seconds, accept finite numbers greater than zero through 2,147,483.647, and have no default.

Omitting a job execution timeout lets the child run until it exits, is cancelled, the session shuts down, or the Pi process exits.

A wait timeout or caller cancellation stops only that wait and does not cancel its job or question request.

Tasks, questions, and replies are limited to 50 KiB of UTF-8 text.

Replies are also limited to 2,000 lines so successful child tool output stays within Pi's tool-result bound.

Each job may have up to four unanswered or not-yet-consumed question requests.

The terminal states are `completed`, `partial`, `failed`, `timed_out`, and `cancelled`.

`subagent_inspect` never returns complete task text, child output, prompts, selected tools, context, credentials, environment variables, questions, replies, or secrets.

See [`docs/tools.md`](./docs/tools.md) for the concise schema reference.

## ⚙️ Job configuration

The task should state the child's role, objective, scope, constraints, and expected result.

The optional `tools` list limits what the child can do.

Accepted names are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`.

Unavailable or extension-only tool names are rejected before a job is queued.

Omitting `tools` selects `read`, `grep`, `find`, and `ls`.

Passing an empty list gives the child no work tools.

The runtime always adds `subagent_ask` and child `subagent_wait` and removes duplicate names.

Adding `edit` or `write` lets the child modify files.

Adding `bash` or `powershell` grants unrestricted command execution and can also modify the workspace.

The optional `thinkingLevel` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

Omitting `thinkingLevel` captures the main agent's effective level when `subagent_spawn` executes.

The child inherits the main agent's effective provider and model when `subagent_spawn` executes.

Spawn rejects providers registered by a parent extension because child processes disable unrelated extensions.

Spawn also rejects process-local runtime API keys, including a parent-only `--api-key` value.

Use stored or environment credentials that child processes can read.

The extension does not expose a per-job model override.

## 🔄 Messaging, lifecycle, and retention

The session starts one TCP broker on `127.0.0.1` with an operating-system-assigned ephemeral port.

Each job receives one cryptographically random token bound to its job identity and session generation.

The parent passes the broker credentials once through a private inherited pipe instead of placing them in the child's initial environment or command line.

The child bridge reads and closes that descriptor before model tool execution.

Each child communication tool call uses one request-scoped connection, while a response wait uses an abortable long poll.

The first accepted `subagent_reply` wins.

Repeated replies acknowledge the existing answer without replacing it.

A child may retry `subagent_wait` after a wait timeout because the underlying request remains active.

A new job starts as `queued`, transitions to `running`, and reaches exactly one terminal state.

The runtime retains up to 32 recent terminal records for up to 24 hours within the current extension session.

Inspection reports older records removed by retention bounds through `omitted.jobs`.

Cancelling or terminalizing a job revokes its token and rejects pending child waits before stale output can replace the terminal state.

Session replacement and shutdown cancel active work, suppress stale completion delivery, revoke credentials, close sockets, and stop the broker.

## 🔀 Migrating from 2.x

Version 3.0 replaces the previous orchestration runtime.

It does not migrate legacy settings, persisted jobs, retained conversations, or recovery state.

Finish or record any required work before upgrading, then start a fresh Pi session so stored calls do not request removed tool names.

Use these replacements where the new job model supports the previous intent:

| Previous interface | Version 3 interface |
| --- | --- |
| `subagent` or `subagent_spawn` | `subagent_spawn` |
| `subagent_await` | `subagent_wait` |
| `subagent_inspect` | `subagent_inspect` |
| `subagent_manage` cancellation | `subagent_cancel` |
| Child-to-main questions | Child `subagent_ask` and `subagent_wait`, plus main `subagent_reply` |

The `/subagents` command, extension settings, `subagent_send`, `subagent_mailbox`, `subagent_consult`, custom agent catalogs, retained follow-ups, advanced orchestration, alternate transports, trust-aware cwd policy, and extension-owned worktrees have no direct replacement.

Describe the child's specialization in `task` and grant only the required work tools through `tools`.

## 🔒 Security and privacy

The selected work tools run in the current working directory.

The default list contains no shell or file-mutation tool.

It is not a filesystem sandbox because its read tools can inspect files available to the user account.

Selecting `bash`, `powershell`, `edit`, or `write` permits workspace mutation with the Pi process environment and user permissions.

Every child disables session persistence, unrelated extensions, skills, and prompt templates.

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

The extension does not load arbitrary extension tools or parent-registered model providers in child processes.

Process-local runtime API keys are not forwarded to children.

The extension does not provide custom agents, per-job models, custom system prompts, peer-to-peer child messaging, retained conversations, user-directed follow-up work, mailboxes, Agent Teams, chains, fan-in aggregators, panels, workflow DAGs, dynamic scheduling, verification orchestration, nested subagents, or extension-owned semantic memory.

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
├── skills/using-pi-subagents/  # Repository-only example delegation skill
├── src/                         # Extension, broker, child bridge, and subprocess runtime
├── test/                        # Protocol, lifecycle, process, and policy tests
├── package.json                 # Pi extension declaration
└── README.md                    # User guide and safety boundaries
```

## 🔎 Keywords

Pi, subagents, delegation, subagent jobs, least privilege, main-agent messaging, cancellation, job lifecycle.

## 📄 License

[MIT](./LICENSE)
