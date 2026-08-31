# Pi native vs Codex Remote V2 compaction benchmark

This repository-only benchmark compares three paths on the same seeded synthetic coding-agent history:

1. An uncompressed full-context control.
2. Pi-native plaintext compaction.
3. This extension's Codex Remote Compaction V2 path.

It measures answerability, exact state recovery, latency, Pi-catalog estimated USD cost, and realized downstream context size.

Benchmark v3 separates ordinary diagnostics from locked confirmatory candidates and measures repeated compaction artifacts instead of treating one hosted response as stable.

## Claim boundary

The default `matched-tail` profile gives Pi and Codex nominal 20K retention settings.

Those settings are not equal information capacities.

Pi retains recent all-role messages and a plaintext summary.

Codex retains approximate user-role text and an opaque compaction item.

The default 50K fixture is a controlled manual-compaction study and does not represent automatic compaction near a model's context limit.

The benchmark measures synthetic exact state recovery rather than general coding quality.

## Metrics

| Area | Primary metric | Supporting metrics |
| --- | --- | --- |
| Answerability | Full-context exact-recall rate per fixture | Parse failures and stop reasons |
| Reliability | Artifact and repeated-probe score distributions | Perfect artifacts, disagreement, and parse failures |
| Compression quality | Seed-level paired Codex-minus-Pi recall | Descriptive totals by density, category, epoch, and question |
| Speed | Artifact-level compaction latency | Probe and end-to-end latency |
| Cost | Artifact-level compaction estimated cost | Probe, end-to-end, and total run cost |
| Footprint | Provider-observed probe input tokens | Compaction output and local post-compaction estimates |

Questions are nested within probes, artifacts, densities, and seeds.

Question totals are descriptive.

Seed-level paired deltas are the independent comparison.

The summary reports every seed delta, median, MAD, mean, and a deterministic seed-clustered bootstrap interval.

## Fixture design

The fixture version is `multi-state-compaction-recall:v2`.

Each fixture has ten history epochs, a fixed estimated history target, and five state categories:

| Category | What it tests |
| --- | --- |
| `exact_recall` | Exact key-to-value state |
| `relational_state` | Directional source-to-target associations |
| `tool_history` | Exact values returned by historical tool calls |
| `distractor_resolution` | Final corrections instead of superseded candidates |
| `task_continuation` | Current status, receipt, and next-action bundles |

Density is the number of authoritative records per category.

Higher density replaces unrelated filler with authoritative state instead of making the fixture proportionally longer.

Questions are selected deterministically across categories and epochs and appear only after compaction.

Expected values appear in historical assistant messages or tool results and never in historical user text.

The full, Pi, and Codex arms receive identical fixture messages and questions.

Dry and live planning both use Pi's installed `estimateTokens` export, so the same code, dependency versions, options, and protocol produce identical fixture hashes.

## Repetition and evaluator reliability

`--repetitions` controls independent Pi and Codex compaction artifacts per fixture.

`--probes-per-artifact` controls isolated probes over each artifact and an equal number of fresh full-context probes.

Each probe receives a cloned pre-probe session branch, so one probe response cannot affect another.

Compaction order alternates and three-arm probe order rotates within every complete seed block.

A confirmatory manifest must use at least three compaction repetitions.

Calibration should repeat probes over fixed artifacts to measure evaluator disagreement.

Any parse failure or exact-answer disagreement above the locked threshold makes the run diagnostic.

The uncompressed full-context control must also score at least 98% in every fixture.

## Diagnostic suites

| Suite | Seeds | Densities | Questions per fixture | Default purpose |
| --- | --- | --- | ---: | --- |
| `exploratory` | 1 | 120 | 15 | Harness and entitlement smoke |
| `calibration` | 111 | 120, 160, 200 | 75 | Select difficulty and test evaluator reliability |
| `confirmatory` | 301–304 | 180, 200 | 75 | Legacy diagnostic compatibility only |

Seeds 301–304 have already been inspected under matched-tail and production policies.

They are permanently consumed and cannot appear in a v3 confirmatory protocol manifest.

A suite-only invocation is always diagnostic, even when its controls match a historical confirmatory command.

## Locked protocol manifests

A confirmatory candidate requires `--protocol <path>`.

The manifest locks:

- Benchmark and protocol versions.
- Calibration evidence SHA-256.
- Model and retention profile.
- Fresh seeds and calibrated densities.
- Questions, epochs, and fixture target.
- Compaction and probe thinking levels.
- Artifact and probe repetition counts.
- Evaluator disagreement threshold.
- Context claim scope.

The runner rejects unknown fields, consumed or duplicate seeds, invalid ranges, and any locked CLI override.

`controlled-manual-50k` requires an exact 50,000-token fixture target.

A `context-scale-diagnostic` manifest can lock a diagnostic study but can never become a confirmatory plan or candidate.

Machine output reports `protocolConformant`, the canonical protocol SHA-256, deviations, and either `diagnostic` or `confirmatory-candidate`.

It never automatically claims that a conformant run was genuinely held out or primary evidence.

Human review must verify that the committed manifest predates provider execution and that its fresh outcomes were not inspected earlier.

See [`protocols/README.md`](./protocols/README.md) for the schema and workflow.

The reviewed calibration plan and completed outcome are in
[`protocols/CALIBRATION-V3.md`](./protocols/CALIBRATION-V3.md).

The locked fresh-seed protocol is
[`protocols/matched-tail-confirmatory-v3-2026-08-14.json`](./protocols/matched-tail-confirmatory-v3-2026-08-14.json).

Its provider-free request, cost, and fixture review is in
[`protocols/CONFIRMATORY-V3-PREFLIGHT.md`](./protocols/CONFIRMATORY-V3-PREFLIGHT.md).

## Safe dry runs

From the repository root, preview the default exploratory diagnostic without provider calls:

```bash
npm run benchmark:codex-compact
```

Preview calibration with repeated evaluator probes:

```bash
npm run benchmark:codex-compact -- \
  --suite calibration \
  --repetitions 1 \
  --probes-per-artifact 3
```

Preview a committed protocol:

```bash
npm run benchmark:codex-compact -- \
  --protocol packages/pi-codex-compact/benchmark/protocols/<protocol>.json
```

Dry-run output includes exact fixture hashes, repetition counts, request order policy, request count, provenance, and protocol identity.

It does not require credentials or contact OpenAI.

Run the deterministic provider-free self-test manually with:

```bash
node packages/pi-codex-compact/benchmark/self-test.mjs
```

The benchmark self-test intentionally remains outside CI.

## Live workflow

Live work requires an explicit `--live` flag, OpenAI Codex OAuth, Remote V2 entitlement, and separate approval after reviewing the dry run.

A fixture makes this many requests:

```text
repetitions × (2 compactions + 3 × probes-per-artifact)
```

For example, three artifact repetitions and one probe per artifact make 15 requests per fixture.

A candidate with eight seeds, two densities, and three repetitions makes 240 requests.

Run calibration only after reviewing its count and cost guard:

```bash
npm run benchmark:codex-compact -- \
  --live \
  --suite calibration \
  --repetitions 1 \
  --probes-per-artifact 3 \
  --max-cost-usd <approved-amount> \
  --output packages/pi-codex-compact/benchmark/results/<calibration>.json
```

After calibration:

1. Preserve and hash the calibration evidence.
2. Select densities without inspecting fresh confirmatory outcomes.
3. Generate fresh seeds that exclude the consumed list.
4. Commit the final protocol manifest before execution.
5. Preview the committed manifest and request separate live-run approval.
6. Run it once and retain any deviation or incomplete result as diagnostic.

A live protocol command is:

```bash
npm run benchmark:codex-compact -- \
  --live \
  --protocol packages/pi-codex-compact/benchmark/protocols/<protocol>.json \
  --max-cost-usd <approved-amount> \
  --output packages/pi-codex-compact/benchmark/results/<result>.json
```

The cost guard is checked between fixtures, so one in-flight fixture can take the estimate past the configured amount.

The runner checkpoints after every completed fixture using same-directory atomic rename.

Checkpoint records remain `in-progress` and diagnostic until final revalidation publishes the completed result.

Before the first provider request, it hashes the local benchmark modules, extension source, package manifest, lockfile, and locked protocol manifest.

It loads every Codex session from a private read-only extension snapshot captured from those bytes.

It rechecks the worktree inputs before every fixture, before each checkpoint, and before final evidence classification.

Any detected addition, removal, or content change is recorded permanently and downgrades the run to diagnostic without changing the snapshotted extension code.

It stops on provider, entitlement, protocol, extension, or validation failure.

It refuses to report silent Pi fallback as a Codex artifact.

## Profiles

| Profile | Pi retained-tail setting | Codex retained user-text setting | Purpose |
| --- | ---: | ---: | --- |
| `matched-tail` (default) | 20K tokens | 20K approximate tokens | Nominal-setting diagnostic or locked study |
| `production` | 20K tokens | 64K approximate tokens | Shipped-policy diagnostic |

Every result sets `equalInformationCapacity` to `false` and reports realized footprint beside the nominal settings.

Never configure one arm from the observed output of its paired treatment.

A future equal-resource analysis should use a predeclared budget frontier rather than a post-treatment cap.

## Result interpretation

The JSON preserves:

- Protocol identity and deviations.
- Runtime, dependency, source, model, estimator, and local executable-input hashes.
- Immutable-extension and source-drift evidence.
- Exact fixture hashes.
- Request sequence and repetition identity.
- Artifact-level checkpoint size without opaque encrypted content.
- Per-probe usage, latency, stop reason, response hash, and exact scores.
- Full-context and fixed-artifact disagreement.
- Seed-level paired quality and descriptive nested totals.
- Realized latency, estimated cost, and downstream input.

A positive Codex-minus-Pi quality delta favors Codex.

A negative Codex-minus-Pi latency or cost delta favors Codex.

Inspect artifact distributions rather than relying only on aggregate recall because Remote V2 allocation can be bimodal.

Output-size correlation is descriptive and does not prove that token count caused quality.

## Preserved evidence

The repository retains the v3 calibration evidence at:

```text
results/calibration-v3-matched-tail-gpt-5.6-sol.json
```

Its SHA-256 is:

```text
23b7e0197a7a921e5e155591b80ce911ccdf07edfc9f37c62f700691e65dad19
```

The calibration used seed 111 only and remains diagnostic evidence.

The repository also retains the earlier v2 matched-tail diagnostic at:

```text
results/matched-tail-same-fixtures-gpt-5.6-sol.json
```

Its SHA-256 is:

```text
526bebd0833528e2dfab8a7203e65a5e9ac4cfbbb9e23a36f7ecba362ab6afc7
```

It used consumed seeds 301–304, one artifact per arm and fixture, and no evaluator repetition.

Neither result may be relabeled as v3 confirmatory evidence.

## Cost, privacy, and cleanup

Live runs send only deterministic synthetic transcripts and probes to the same OpenAI Codex backend used by Pi.

They do not send repository content or user sessions.

The runner reads credentials through Pi's model runtime and never stores tokens or headers in results.

Temporary extension settings and sessions are removed after success, failure, or cancellation.

Opaque content is represented only by SHA-256 and byte count.

Dollar values use Pi's model catalog and returned usage and are not an OpenAI invoice.

## Limits

- Remote Compaction V2 is an undocumented hosted protocol and can change independently.
- The runner hashes local benchmark and extension inputs, but dependency provenance remains version- and lockfile-based and cannot identify an unpublished provider-side model revision.
- Synthetic exact-state tasks do not measure real coding success, images, resume, fork, model switching, or tool execution after compaction.
- The controlled 50K regime is not automatic-threshold evidence.
- Provider load, cache state, OAuth tier, and model updates can affect latency, usage, and quality.
- Even eight independent seeds remain a limited generalization sample.
- The Codex arm measures this extension's projection path, not the complete Codex CLI lifecycle.
