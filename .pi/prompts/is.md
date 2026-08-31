---
description: Investigate a GitHub issue and propose an implementation plan
argument-hint: "<issue URL or number>"
---

Issue: $ARGUMENTS

Follow this workflow:

1. Identify the issue from its URL or number.
   Use the current repository for a bare issue number, and ask if the target is missing or ambiguous.
2. Read the complete issue, including its description, discussion, linked context, labels, and current status.
3. Inspect the repository instructions, relevant code, tests, documentation, and history.
4. Classify the request and investigate it:
   - For a bug, reproduce it safely when practical, compare expected and actual behavior, and identify the root cause.
   - For a feature, identify the users, use cases, constraints, compatibility needs, and measurable acceptance criteria.
5. Define the scope, expected outcome, implementation approach, risks, and verification plan.
6. Present a concise implementation plan.

This work does not modify files, branches, or issue metadata.
Do not claim reproduction or passing checks without evidence.
