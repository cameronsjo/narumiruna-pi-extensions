# Benchmark v3 confirmatory preflight

This preflight was generated without provider requests from committed source revision `d8a2149e6d332d4465ce61d638920e548a66e3e5`.

It does not authorize the live run.

The user reviewed the sampling basis and chose not to execute the paid confirmatory run.

No confirmatory provider request was made.

## Locked identity

- Protocol: `matched-tail-confirmatory-v3-2026-08-14.json`.
- Canonical protocol SHA-256: `5d2e1a6e0c4c45c9a4824e76e5d498c5c99e35365418029ee399e912ad851a10`.
- Calibration evidence SHA-256: `23b7e0197a7a921e5e155591b80ce911ccdf07edfc9f37c62f700691e65dad19`.
- Model: `openai-codex/gpt-5.6-sol`.
- Profile: matched-tail Pi 20K and Codex 20K nominal settings.
- Context regime: controlled manual 50K.
- Fresh seeds: 5322, 49672, 109707, 143411, 181659, 223692, 427727, and 483598.
- Densities: 120 and 160.
- Compaction repetitions: three artifacts per arm and fixture.
- Evaluator probes: one isolated probe per artifact and one equal full-context probe per repetition.
- Evaluator disagreement threshold: 2%.

The planner reported a conformant confirmatory plan, no deviations, no consumed seeds, clean tracked inputs, and a manifest tracked unchanged at the source revision.

The runner still sets `humanPrimaryClaim` to `false` because held-out provenance requires human review.

## Request and cost exposure

- Planned fixtures: 16.
- Planned provider requests per fixture: 15.
- Planned provider requests: 240.
- Proposed between-fixture cost guard: $100.
- Calibration-based projected recorded cost: $78.682920.

The projection reuses each selected calibration fixture's observed three-probe cost and adds two Pi and two Codex compaction costs to represent the locked three-artifact design.

It is only a planning estimate because provider output length, latency, and catalog-based usage cost can vary.

The $100 guard is checked between fixtures and is not a strict invoice cap because one in-flight fixture can finish after the estimate crosses the guard.

## Fixture identities

| Fixture | Estimated tokens | SHA-256 |
| --- | ---: | --- |
| `multi-state-compaction-recall:v2:s5322:d120` | 50,056 | `456fa3d094bb6fc6cb7b2f3818149ba1d134b75bf8aacf4f254ded9676070365` |
| `multi-state-compaction-recall:v2:s49672:d120` | 50,056 | `3fb0ff191d77e44b64207b459e39410d99c8162bcea16959e44a647ebdefcc87` |
| `multi-state-compaction-recall:v2:s109707:d120` | 50,056 | `d5f796d0ab089a41e822fe22bc45de063a1ef7e0657e916054ad28d6511c0185` |
| `multi-state-compaction-recall:v2:s143411:d120` | 50,056 | `72f2ff3d9d61ad9a94aec810b251ee0b4b9681ed4698c318a68b835e04da42b3` |
| `multi-state-compaction-recall:v2:s181659:d120` | 50,056 | `b6bf7ea1987500e10dc5b045943344c539a2a4670c806f6a51829cec73e89e30` |
| `multi-state-compaction-recall:v2:s223692:d120` | 50,056 | `ea49e055588b86841dccc28f604b1a49b08d4aa15d413477905e3f27752cc03c` |
| `multi-state-compaction-recall:v2:s427727:d120` | 50,056 | `bbdbd46f9ef248da2c0ee92d221bd06c400b9380c84f35e30ab4c6fe703b4cb3` |
| `multi-state-compaction-recall:v2:s483598:d120` | 50,056 | `3b02e7c0b7b73563970e0f44bac5ed37f1578a51c0e223d1f6840b73eb3024c5` |
| `multi-state-compaction-recall:v2:s5322:d160` | 50,056 | `b28287e717c32edb870a42f4e898061cb8871a9c2fea9a2672607e8f7df6f4d6` |
| `multi-state-compaction-recall:v2:s49672:d160` | 50,056 | `d8750281bae5434ddbc691cf6a73e2fad8aaa61a1ad7dcac0a1cde621eb8deca` |
| `multi-state-compaction-recall:v2:s109707:d160` | 50,056 | `cad544fbb33cdd96bd6772846e75789a0209771d27fcb008dd804d5cbdfb46e5` |
| `multi-state-compaction-recall:v2:s143411:d160` | 50,056 | `95f9c4b00399ca8e98b1e04371f060d746762bfd84413b8441a41e748f09c0bc` |
| `multi-state-compaction-recall:v2:s181659:d160` | 50,056 | `8e469c7f4a8512e624d722c9be4ba33488fac2e97f3905c838b99701daf971bb` |
| `multi-state-compaction-recall:v2:s223692:d160` | 50,056 | `e99a0e768a05474a4dfc5607edac8a84ca8d326ae892a8f7bde7c7e8e3b2fa0f` |
| `multi-state-compaction-recall:v2:s427727:d160` | 50,056 | `dc8bd3c073d75dd91a96c24b24618270e097070089e9dbfc99ed92de02317a57` |
| `multi-state-compaction-recall:v2:s483598:d160` | 50,056 | `62f6df4ba3df6c66491146efcb0ab9c072d5b3fe455664fb669cca14ad5624b2` |

## Approval-gated command

Do not run this command until the user separately approves all 240 requests and the $100 between-fixture guard.

```bash
npm run benchmark:codex-compact -- \
  --live \
  --protocol packages/pi-codex-compact/benchmark/protocols/matched-tail-confirmatory-v3-2026-08-14.json \
  --max-cost-usd 100 \
  --output packages/pi-codex-compact/benchmark/results/confirmatory-v3-matched-tail-gpt-5.6-sol.json
```
