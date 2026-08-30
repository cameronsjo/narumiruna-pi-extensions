# pi-herdr Bidirectional Integration Roadmap

## Vision

Make `pi-herdr` the lightweight bridge that lets Pi and Herdr share live context in both directions without replacing Herdr's TUI, duplicating its CLI, or distracting users when no coordination needs attention.

**Current roadmap status:** The Phase 1 agent widget is delivered and verified, while the optional footer summary and Phases 2–4 remain planned.

## Objectives

- **Make nearby agent activity visible in Pi** — Success after Phase 1: a responsive editor widget accurately reflects relevant sibling-agent state from Herdr, starts no steady-state CLI polling, and leaves no UI or socket resource after session shutdown.
- **Give Herdr useful Pi context** — Success after Phase 2: Herdr can display bounded, current Pi session and model metadata without exposing conversation content or allowing stale sessions to publish updates.
- **Make inspection and coordination deliberate** — Success after Phase 3: users can inspect current Herdr context and invoke a small set of explicit, accurately labelled actions without requiring model interpretation.
- **Keep the skill and runtime compatible** — Success throughout: unsupported Herdr protocols degrade without interrupting Pi, and every documented CLI discovery path is valid for the supported Herdr surface.

## Current State

- `packages/pi-herdr/src/herdr-agent-state.ts` reports the current interactive Pi session plus `working`, `blocked`, and `idle` state to the Herdr socket.
- The extension coalesces state changes, retries bounded delivery failures, guards session generations, and aborts reporting during shutdown.
- The bundled `herdr` skill provides explicit, on-demand CLI guidance for inspecting and controlling workspaces, tabs, panes, agents, commands, and notifications.
- The extension now renders a terminal-safe, event-driven widget with one state, agent, pane, and workspace row per recognized sibling and maintains pane-scoped status subscriptions with bounded failure recovery.
- The extension still has no footer status, `/herdr` command, pane metadata publication, autocomplete, or watch notification.
- The installed Herdr 0.8.2 API exposes `pane.current`, `pane.list`, `events.subscribe`, pane lifecycle and agent-status events, `pane.report_metadata`, and protocol metadata through its public schema.
- The bundled skill currently lists `herdr terminal` as a discovery group even though that group is absent from the installed Herdr 0.8.2 CLI.
- The repository has no telemetry or grounded adoption baseline, so usage and delivery targets remain unknown.

## Guiding Principles

- **Ambient before interactive:** establish trustworthy read-only awareness before adding coordination actions.
- **Attention over noise:** show blocked, completed, or active work prominently and hide permanent ready-state decoration.
- **Event-driven by default:** use Herdr snapshot and subscription APIs instead of recurring CLI subprocesses.
- **Graceful degradation:** preserve existing outbound lifecycle reporting when reverse integration is unavailable or incompatible.
- **One authority per concern:** let Herdr own workspace state and control semantics while Pi owns its widget, status, lifecycle, and session metadata.
- **Public surfaces only:** rely on Pi extension APIs and Herdr's published CLI or socket schema rather than screen scraping or private implementation details.

## Roadmap

### Phase 1: Establish trustworthy ambient awareness

- [x] A Pi widget above the editor presents one bounded state, agent, pane, and workspace row per relevant sibling, excludes the current pane, distinguishes `blocked`, `done`, `working`, `idle`, and `unknown`, and hides when there is nothing useful to show.
  Evidence: focused model and rendering tests plus a Herdr-managed TUI smoke cover every state, five-row overflow, empty state, and narrow rendering.
- [x] Widget state initializes from authoritative `pane.current` and `pane.list` reads and remains current through topology plus pane-scoped status subscriptions without steady-state CLI polling, while disconnects and unsupported responses degrade without interrupting Pi.
  Evidence: protocol, client, observer, replay, reconnect, and live moved-pane tests pass.
- [ ] An activity-only `herdr` footer status summarizes conditions needing attention and remains absent when there is no blocked, completed, or active sibling work.
- [x] Session replacement, reload, shutdown, failed initialization, and reconnect exhaustion leave no open subscription, retry task, widget, or status owned by the old session.
  Evidence: lifecycle tests cover delayed stale work, replacement during shutdown, repeated shutdown, one bounded reconnect, and exhaustion.
- [x] Every displayed Herdr-derived label, title, path, and state label is terminal-safe, width-bounded, and tested under narrow rendering.
  Evidence: hostile ANSI, OSC, bidi, newline, Unicode, zero-width, narrow-width, and theme-invalidation tests pass.

**Outcome:** Pi users can understand nearby Herdr activity at a glance without switching views, paying a polling cost, or risking stale lifecycle resources.

### Phase 2: Enrich Herdr with bounded Pi context

- [ ] Herdr pane metadata exposes a stable Pi display identity and useful session title when available without replacing user-owned pane labels or leaking message content.
- [ ] Model, provider, thinking level, and bounded context-usage metadata remain current through Pi lifecycle events and use a publication cadence that avoids volatile socket traffic.
- [ ] Metadata ownership, sequence ordering, replacement, and shutdown behavior prevent an older Pi session from overwriting newer pane state.
- [ ] The integration documents exactly which environment, session, model, and prompt-label fields cross the Herdr socket boundary.

**Outcome:** Herdr can explain which Pi session and model occupy a pane while preserving privacy and source ownership.

### Phase 3: Add a deliberate Pi-native Herdr dashboard

- [ ] `/herdr` provides a current-state TUI dashboard for relevant agents and panes, with an explicit non-TUI behavior decision and no silent fallback into terminal-only UI.
- [ ] Read-only inspection exposes bounded recent output, lifecycle state, blocked reason, and stable target identifiers without marking background completion as seen.
- [ ] A documented go/no-go decision approves only frequent, unambiguous actions such as focus, prompt, wait, or watch when their cancellation, targeting, and safety semantics can match the Herdr CLI.
- [ ] Every approved action is labelled with its workspace or pane effect, preserves user focus unless requested, and reports CLI or socket failures observably.

**Outcome:** Users gain a predictable Pi-native path from awareness to intentional coordination without reproducing the full Herdr TUI or CLI.

### Phase 4: Improve discovery without expanding ambient complexity

- [ ] Agent or pane autocomplete is delivered only if a stable insertion syntax and target identity improve a demonstrated workflow without intercepting ordinary `@` or path completion.
- [ ] Opt-in watch notifications distinguish `blocked` from unseen `done`, avoid notifying for every idle transition, and can be cancelled or cleared with the owning session.
- [ ] A documented decision either retains skill-plus-`bash` as the model control surface or introduces a narrowly scoped typed tool only when it provides measurable safety or reliability beyond the CLI guidance.
- [ ] Bundled skill discovery commands and examples are verified against the supported Herdr CLI surface, with version-sensitive behavior delegated to installed `herdr --help` output.

**Outcome:** Higher-frequency workflows become easier to discover while model prompt weight, notification noise, and duplicated command semantics remain controlled.

## Success Metrics

| Indicator | Baseline | Target or invariant | Measurement source |
| --- | --- | --- | --- |
| Herdr state visible inside Pi | Current-workspace widget delivered | Every accepted relevant status event or authoritative topology refresh is reflected by the next widget publication | State-model, observer, and live TUI tests |
| Steady-state CLI subprocesses for widget updates | 0 | 0 | Source review and live smoke |
| Rendered widget lines exceeding available width | 0 in deterministic coverage | 0 | Narrow-width and untrusted-input tests |
| Session-owned resources remaining after shutdown | 0 in deterministic coverage | 0 subscriptions, retry tasks, widgets, or statuses | Lifecycle tests |
| Stale session metadata accepted after replacement | Existing outbound generation guards only | 0 | Sequence and replacement tests |
| Invalid documented CLI discovery groups | At least 1 against installed Herdr 0.8.2 | 0 for the supported CLI fixture | Skill/CLI contract check |
| Adoption and coordination task completion | Unknown | TBD if privacy-compatible evidence becomes available | No current measurement source |

## Risks and Dependencies

| Risk or dependency | Impact | Mitigation or decision |
| --- | --- | --- |
| Herdr socket protocol or event schemas change across versions | Reverse state could fail or become misleading | Structurally validate narrow workspace reads and events, reject invalid frames, test supported fixtures, and preserve outbound reporting when reverse features are disabled. |
| A long-lived subscription adds reconnect and shutdown complexity | Reloads or replacement sessions could leak work or repaint stale UI | Give each session one abortable owner, use bounded backoff, revalidate generation after every await, and clear exact UI keys during all teardown paths. |
| Persistent widgets consume scarce terminal rows | Ambient status could distract more than it helps | Default to current-workspace siblings, bound rows, collapse overflow, and hide when no useful state exists. |
| Herdr-derived terminal text is untrusted | Titles, paths, or state labels could inject controls or break layout | Sanitize at the display boundary before presentation sorting or truncation while preserving raw protocol data internally. |
| Herdr `done` depends on unseen background completion | Reading state from Pi could accidentally change user-visible semantics | Use read-only APIs that do not focus panes or mark tabs seen, and test that widget inspection preserves `done`. |
| Agent names or display labels may be absent or non-unique | Widget rows and actions could become ambiguous | Keep agent identity primary, show pane and workspace labels with short stable IDs in separate visual roles, and resolve future actions through raw Herdr identifiers. |
| A command dashboard can drift into a second Herdr TUI | Maintenance and safety scope could expand rapidly | Keep Phase 3 current-context and menu-first, and require a separate go/no-go decision for each mutating action. |
| New settings would introduce persistence and precedence obligations | Early delivery could become dominated by configuration complexity | Use a useful zero-configuration default first and adopt extension settings only after a concrete user need is established. |

## Decisions and Changes

- **2026-08-30 — Put the widget first:** reverse ambient observability closes the largest gap between the existing outbound extension and on-demand skill.
- **2026-08-30 — Prefer a widget over editor replacement:** `ctx.ui.setWidget()` preserves editor composition, keybindings, paste behavior, and compatibility with other editor extensions.
- **2026-08-30 — Prefer subscription over polling:** authoritative workspace reads plus topology and pane-scoped status subscriptions provide a lower-overhead and more truthful source than recurring `herdr agent list` subprocesses.
- **2026-08-30 — Reconcile replayed topology:** Herdr replays retained topology events, so the widget coalesces them into fresh workspace reads and rebuilds status subscriptions only when the recognized pane set changes.
- **2026-08-30 — Keep one agent per row:** each row uses theme roles to present state, agent name, pane label and short ID, then workspace label and short ID without misclassifying terminal titles as agent identity.
- **2026-08-30 — Defer broad model tools:** the bundled skill and installed CLI remain authoritative until a narrow typed tool proves additional safety or reliability.

## Non-Goals

- Replace the Herdr TUI, sidebar, workspace manager, or terminal layout controls.
- Mirror every Herdr CLI command as a Pi slash command or model tool.
- Start agents, create worktrees, move panes, or send prompts autonomously without explicit user intent.
- Replace Pi's editor component solely to display Herdr state.
- Show permanent `ready`, `connected`, or `on` decoration when no coordination state needs attention.
- Poll the Herdr CLI continuously for widget updates.
- Enable notifications for every agent transition by default.
- Claim interactive widget or dashboard support in JSON or print mode.
- Authorize a package version bump, npm publication, tag, or release workflow.

## Assumptions and Unknowns

- This roadmap is for maintainers and contributors, and no delivery dates, owners, capacity commitments, or planning horizon were supplied.
- Current-workspace sibling agents are assumed to be the most useful default scope, but user demand for current-tab or all-workspace views is unknown.
- A zero-configuration widget is assumed to be preferable initially, while demand for placement, visibility, filtering, or row-limit settings is unknown.
- Herdr's public socket schema is assumed to remain available to managed panes, but the minimum supported protocol and compatibility window require an explicit implementation decision.
- Demand for autocomplete, watch notifications, direct actions, and typed model tools is unknown and remains gated behind demonstrated workflows.
