---
description: Review a pull request for correctness, impact, risks, and verification
argument-hint: "<PR URL or number>"
---

Target: ${ARGUMENTS:-the pull request for the current branch}

Review the target pull request without changing code, posting comments, approving it, or merging it.

1. Identify the pull request and its base branch.
   If the target is missing or unclear, ask instead of guessing.
2. Read the repository instructions, pull request title and description, linked issues, commits, checks, and complete diff.
3. Read all submitted reviews, inline comments, and discussion threads.
   Verify each concern yourself because earlier feedback may be incomplete or outdated.
4. Inspect the relevant code, tests, documentation, history, callers, and downstream behavior.
5. Determine the goal, change type, implementation approach, and actual changes.
   For a bug fix, identify the root cause and whether the change addresses it.
6. Compare intended behavior before and after the change, including behavior that should remain unchanged.
7. Trace the repository impact across packages, modules, public contracts, dependencies, build and test workflows, deployment, documentation, and maintenance.
8. Look for real problems in:
   - Correctness and edge cases.
   - Error handling, cleanup, retries, concurrency, and state changes.
   - Security, permissions, validation, secrets, and sensitive data.
   - System boundaries, dependencies, public contracts, and how far failures can spread.
   - Performance, resource use, compatibility, deployment, migrations, rollback, and monitoring.
   - Test coverage and documentation.
9. Run focused checks when practical.
   Treat passing checks as evidence, not proof that the code is correct.
10. Report only findings caused, exposed, or made worse by this pull request.
    Separate directly relevant pre-existing problems and omit style-only comments unless requested.
11. Distinguish confirmed problems from possible risks and unverified areas.

Use this output structure:

## Goal

Explain in simple terms why the pull request exists and what result it is trying to achieve.

## Root cause (optional)

Include this section for bug fixes when the root cause can be established.
Explain why the bug occurred and whether the change addresses the cause rather than only the symptom.
If an unverified root cause matters to the merge decision, report it under **Risks** or **Open questions** instead.
Omit this section for changes that do not fix a bug.

## Implementation approach (optional)

Explain the important design or technical approach and why it was used.
Include this section when the approach materially helps explain a feature, fix, refactor, documentation workflow, or other non-trivial change.
Omit it for simple or self-explanatory edits.

## Changes

Summarize what was added, modified, or removed by behavior or module instead of repeating the diff file by file.
Call out changes to APIs, configuration, data structures, commands, UI, documentation, and dependencies when relevant.

## Expected behavior (optional)

Describe observable behavior before and after the change, including behavior that is intentionally preserved.
Include this section when behavior changes or compatibility is an important claim.
For a refactor, state when the expected outcome is no behavior change.
Omit it when there is no meaningful behavior to compare.

## Repository impact

Explain which packages, modules, callers, downstream behavior, public contracts, dependencies, workflows, deployment, documentation, or maintenance are affected after merge.
Call out compatibility, migration, rollback, release, or operational effects when relevant.
If the impact is limited, say so explicitly, such as a documentation-only change with no runtime or public API impact.

## Findings

List confirmed findings from highest to lowest severity: **Critical**, **Major**, then **Minor**.
Use **Critical** for severe security, data loss, or widespread failure; **Major** for merge-blocking defects; and **Minor** for real, low-risk defects.
For each finding, include the file and line, the trigger, the impact, and a practical fix.
If there are no confirmed findings, say so clearly.

## Risks (optional)

List material risks and unverified areas separately.
Omit this section when there are none.

## Verification

State what tests and other checks cover, what is missing, which checks you ran, and which checks you could not run.

## What looks good (optional)

Briefly note strong design, implementation, tests, or documentation.
Omit this section when there is nothing meaningful to highlight.

## Open questions (optional)

Include only questions that block a merge decision and require user input.
Omit this section when there are none.

## Verdict

Match the verdict to the findings:

- Use **Request changes** for any Critical or Major finding.
- Use **Approve with minor comments** when only Minor findings remain.
- Use **Needs more context** when missing evidence blocks the decision.
- Use **Approve** when no confirmed findings remain.

Explain the verdict in one or two sentences.
