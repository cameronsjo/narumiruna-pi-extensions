# Pi Subagents tools

## `subagent_spawn`

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `task` | `string` | Yes | Self-contained task, up to 50 KiB of UTF-8 text. |
| `tools` | `string[]` | No | Up to 64 names from `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`; defaults to `read`, `grep`, `find`, and `ls`. |
| `thinkingLevel` | `string` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; defaults to the main agent's effective thinking level. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default timeout. |

Starts one task-specialized subagent job with the selected tool capabilities and returns its job ID immediately.

The runtime always adds `subagent_send` and `subagent_wait` to the selected tools.

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

Returns `{ jobId, state, timedOut: false, interrupted: true, reason: "subagent_message" }` without cancelling the job when a child request or response arrives.

### Subagent

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `requestId` | `string` | Yes | Request ID returned by a child-originated `subagent_send`. |
| `timeout` | `number` | No | Seconds; `> 0` through `2,147,483.647`; no default and does not cancel the request. |

Returns the main agent's response as plain text.

A timeout or caller cancellation throws and stops only that wait, so the child may wait for the same request again.

## `subagent_send`

Main and child processes receive the same provider-visible tool definition.

| Parameter | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `recipient` | `string` | Conditional | Recipient for a new request; use an active job ID from main or `main` from a child. |
| `requestId` | `string` | Conditional | Pending request to answer. |
| `message` | `string` | Yes | Plain-text request or response, up to 50 KiB of UTF-8 text. |

Provide exactly one of `recipient` or `requestId`.

A new request provides `recipient` and omits `requestId`.

A response provides `requestId` and omits `recipient`.

The main agent may send a new request only to a queued or running job ID.

A child may send a new request only to the literal recipient `main`.

A main-originated request waits for the child RPC prompt to be accepted and then uses Pi steering to reach the running child.

A child response arrives asynchronously in the main session and interrupts an active main-agent `subagent_wait`.

A child-originated request returns a request ID immediately, and the child may pass that ID to `subagent_wait`.

The first accepted response wins, and repeated responses acknowledge the existing response without replacing it.

Each job may have up to four unresolved or answered-but-not-consumed requests across both directions.

Responses are limited to 2,000 lines.

Terminal jobs, unknown requests, cross-job responses, responses from the request originator, and stale session credentials throw.

A successful call returns `{ requestId, accepted, duplicate }`.
