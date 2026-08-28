# Pi Subagents tools

## `subagent_spawn`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `task` | `string` | Yes | Self-contained assignment, up to 50 KiB of UTF-8 text. |
| `agent` | `string` | No | Lowercase kebab-case name from `<getAgentDir()>/pi-subagents.json`; empty, whitespace-only, or omitted selects no profile. |
| `tools` | `string[]` | No | Up to 64 names from `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`; defaults to the selected profile, then `read`, `grep`, `find`, and `ls`. |
| `thinkingLevel` | `string` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; defaults to the selected profile, then the main agent's effective level. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; defaults to the selected profile, otherwise no timeout. |

Starts one task-specialized subagent job with the effective tool capabilities and returns its job ID immediately.

A selected agent requires `task`, `tools`, `timeout`, and `thinkingLevel` in the user JSON object.

The `/subagents` TUI manager owns profile creation, field updates, rename, deletion, validation, and atomic user-file publication.

Unknown profile fields are preserved by manager mutations.

Its non-empty `task` is limited to 50 KiB and appended to the child system prompt.

Explicit spawn `tools`, `timeout`, and `thinkingLevel` values override profile defaults.

Profile selection reads the file for each spawn and rejects missing, malformed, unknown, or invalid selected definitions before queueing.

The runtime always adds `subagent_ask` and `subagent_wait` to the effective tools.

The child inherits the main agent's effective provider and model at spawn time.

Providers registered by a parent extension throw before the job is queued because children disable unrelated extensions.

A process-local runtime API key, including a parent-only `--api-key` value, also throws before queuing.

Use Pi's stored credentials or environment credentials that the child process can read.

Unavailable or extension-only tool names throw before the job is queued.

Throws without launching a child when the session broker is unavailable.

## `subagent_inspect`

No parameters.

## `subagent_cancel`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID returned by `subagent_spawn`. |

## `subagent_wait`

### Main agent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Job ID to wait for. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the job. |

Returns `{ jobId, state, timedOut: false, interrupted: true, reason: "subagent_message" }` without cancelling the job when any unanswered child question needs a main-agent response.

### Subagent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Request ID returned by `subagent_ask`. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the request. |

Returns the main agent's response as plain text.

A timeout or caller cancellation throws and stops only that wait, so the child may wait for the same request again.

## `subagent_ask`

Available only to subagents.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `message` | `string` | Yes | Self-contained question for the main agent, up to 50 KiB of UTF-8 text. |

Returns a request ID immediately.

Each job may have up to four unanswered or answered-but-not-consumed requests.

## `subagent_reply`

Available only to the main agent.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Pending request ID received from a subagent. |
| `message` | `string` | Yes | Plain-text response, up to 50 KiB of UTF-8 text and 2,000 lines. |

The first accepted response wins.

Returns an acknowledgement without replacing an earlier response.
