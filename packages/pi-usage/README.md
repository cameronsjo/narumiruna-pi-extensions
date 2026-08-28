# 📊 pi-usage — Check Provider Usage, API Balance, and Codex Fast Mode

[![npm](https://img.shields.io/npm/v/@narumitw/pi-usage)](https://www.npmjs.com/package/@narumitw/pi-usage) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Inspect usage and DeepSeek API balance for Pi's active provider account, query other configured providers, and toggle Fast mode for supported OpenAI Codex models.

The extension keeps each provider's native quota, allowance, and spending semantics instead of treating unlike values as equivalent.
xAI OAuth subscription reporting defaults to On and follows the reviewed Grok Build contract.

## ✨ Features

- Shows active-account usage and next actions through `/usage`.
- Reports OpenAI Codex subscription windows, credits, resets, and model-specific buckets.
- Reports Kimi For Coding plan windows, resets, and separately labeled booster-wallet currency.
- Reports GitHub Copilot allowances and OpenRouter per-key limits and spending windows.
- Reports exact DeepSeek API balances with separate CNY and USD values.
- Reports OpenCode Go plan windows and Z.AI Coding Plan quotas.
- Reports xAI OAuth subscription allowances and credits when enabled.
- Toggles persistent Codex Fast routing through `/fast` or the usage menu.
- Redeems eligible Codex resets only after fresh account matching and explicit confirmation.
- Refreshes one or all configured providers with bounded concurrency while preserving partial results.
- Scopes statusline and cache data to the active provider and runtime account.
- Resolves credentials through Pi or the process-local OAuth credential-source protocol and validates the effective provider endpoint before sending them.

## 📦 Install

Requires Pi 0.81.0 or newer to validate the effective base URL for resolved provider auth before sending credentials to an official usage endpoint.
The v1 credential-source path is characterized against Pi 0.84.3; other runtimes keep the standalone fallback without its protocol timing guarantee.

Like every Pi extension, this package runs with Pi's process permissions.
Review [Security and privacy](#-security-and-privacy) before installation.

```bash
pi install npm:@narumitw/pi-usage
```

Try without installing permanently:

```bash
pi -e npm:@narumitw/pi-usage
```

Build and try this package locally from the repository root:

```bash
npm --workspace @narumitw/pi-usage run build
pi -e ./packages/pi-usage
```

The package declares `dist/index.ts`, so an unbuilt local checkout must run the build before Pi loads the package directory.

## 🚀 Quick start

Run `/usage` in TUI or RPC mode to inspect the active provider, refresh its usage, or choose another configured provider.
Run `/fast` to toggle Fast mode for a supported active Codex model.

## 💬 Commands

Open the manager with:

```text
/usage
```

In TUI or RPC mode, the menu first queries the active model provider and then offers these actions:

```text
Refresh current usage
Settings
Turn Fast mode on/off       # Supported current Codex models only
Redeem usage limit reset…   # Current Codex OAuth accounts only
View another configured provider…
View all configured providers…
Close
```

`/usage` accepts no arguments, including `--refresh`, a provider ID, or `--all`.
Cross-provider requests require an explicit interactive choice.
Escape returns from provider selection or closes the root menu.
Print and JSON modes reject `/usage` because they cannot host the interactive flow.
The extension owns the cancellable live-query progress view because it streams provider work and supports in-flight abort.

For the current OpenAI Codex provider, **Redeem usage limit reset…** first checks fresh earned-reset details.
When details are available, you select a reset and review its exact effect before confirmation.
**No, go back** is the safe default and cancellation before confirmation sends no mutation.
After confirmation, the reset operation cannot be cancelled from its progress view; session replacement or shutdown still aborts owned work.
A transport failure offers **Try again** with the same redemption request ID so the backend can treat an uncertain retry idempotently.
Successful, already-completed, not-needed, and no-credit outcomes are reported separately, then usage and the statusline are refreshed for the still-current account.

## ⚙️ Settings

Choose **Settings** in `/usage` to edit Codex Fast mode and xAI usage through Pi's settings-list interaction in TUI mode.
RPC mode reports the active manual settings path instead of opening terminal UI.

Both preferences live in `pi-usage.json` under Pi's user agent directory, normally `~/.pi/agent/pi-usage.json`.
The extension reloads this file at every session start and does not create it until the first successful save.
Within one Pi process, changes save immediately in invocation order.
Saves preserve unknown JSON fields and publish through a private temporary file plus rename.
Malformed or invalid files remain untouched.
A failed save restores the prior displayed and effective value, while shutdown waits for queued writes.
Separate Pi processes are not mutually locked.

### Codex Fast mode

Run `/fast` without arguments to toggle Fast for the active supported Codex model, or use **Turn Fast mode on/off** in `/usage`.

Fast is about 1.5× faster and uses more of your plan allowance.
The `codexFastMode` preference defaults to Off.

Fast currently applies only to official `openai-codex-responses` requests for `gpt-5.4`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` at `https://chatgpt.com`.
It sends `service_tier: "priority"` while enabled and explicit `service_tier: "default"` otherwise.
The statusline adds `fast` only while the preference is effective, for example `codex fast 59% 5h`.
Unsupported models and custom or proxy origins are left unchanged.

`/fast` supports TUI and RPC mode, accepts no arguments, and rejects print or JSON mode before mutation.
A toggle affects provider requests whose payload hook starts after the save; a request already sent is unchanged.
Repair or remove an invalid file, then run `/reload` before trying the toggle again.

### Codex statusline reset countdown

The `codexStatusResetCountdown` preference defaults to `true`. It replaces the window labels with the time remaining until each returned limit resets.

Set it to `false` in `pi-usage.json`, then run `/reload`, to restore the legacy `5h` and `wk` labels:

```json
{
  "codexStatusResetCountdown": false
}
```

### xAI usage

The `xaiUsage` preference defaults to `true` when the settings file or field is absent.
Turn it Off in the TUI Settings screen or edit the active user file manually, then run `/reload`:

```json
{
  "xaiUsage": false
}
```

While enabled, xAI is available only through explicit `/usage` current, configured-provider, or all-provider actions.
It does not schedule xAI requests or publish xAI data to the statusline.
The disabled, malformed, and invalid-settings states perform no xAI usage auth resolution or consumer requests.
Turning it Off clears xAI cache state and prevents stale in-flight results from being published.

## 📋 Provider semantics

### OpenAI Codex

- Provider ID: `openai-codex`
- Semantics: ChatGPT consumer subscription limits
- Source: the Codex usage and earned-reset endpoints using Pi's resolved runtime authorization
- Displayed data: returned duration-based windows, resets, credits, earned usage-limit resets, and additional model buckets
- Reset mutation: `POST /wham/rate-limit-reset-credits/consume` with a unique redemption request ID and, when available, the selected opaque credit ID
- Statusline examples: `codex 59% (resets in 2h 30m) 61% (resets in 2d 15m)`, `codex fast 59% (resets in 2h 30m)`, or `codex spark 100% (resets in 2h 30m)`. Set `codexStatusResetCountdown` to `false` for the legacy `5h` and `wk` labels.

The statusline selects a returned bucket that matches the current Codex model when one is available.
Unlike `pi-codex-usage`, this successor intentionally has no Codex CLI fallback because the CLI may be logged into a different account than Pi's active runtime account.

Reset redemption is available only when Codex is the current provider.
Pi's freshly resolved access token must exactly match an OAuth credential from Pi's stored login or a compatible credential source.
`pi-usage` forwards only the bearer authorization and matching `chatgpt-account-id` to the official ChatGPT origin.
API-key credentials, configured-but-not-current Codex accounts, account changes during the flow, and custom/proxy origins fail before mutation.
Backend-provided titles and descriptions are sanitized for terminal display.
Opaque credit and account IDs are never shown or persisted by the extension.

### Kimi For Coding

- Provider ID: `kimi-coding`
- Semantics: Kimi Coding Plan request windows plus a separate Extra Usage booster wallet
- Source: `GET https://api.kimi.com/coding/v1/usages` using Pi's freshly resolved runtime Bearer credential
- Displayed plan data: the weekly summary, returned sub-windows, used and remaining request percentages, and valid reset times
- Displayed wallet data: balance, monthly spend, and monthly charge limit
- Statusline examples: `kimi 99% 5h 96% wk` or `kimi 95% 1d`

Both Pi API-key credentials and Pi OAuth credentials are accepted because current Pi resolves each form as Bearer authorization for the same official Kimi inference origin.
The extension queries the fixed usage endpoint only when both the selected model origin and the effective resolved-auth origin are `https://api.kimi.com`.
Custom and proxy origins fail before network access, redirects are rejected, and the credential is never sent to an override from Kimi Code's environment-specific development path.

Plan buckets remain integer request counts and are rendered with their source-defined windows.
Unknown units, duplicate windows, missing counts, invalid timestamps, and malformed rows remain unavailable rather than receiving guessed semantics.
Booster-wallet `amount` and `amountLeft` values use Kimi's first-party conversion of 1,000,000 fixed-point units per cent, while monthly values already arrive in cents.
Wallet values retain their currency and stay separate from plan requests and percentages in reports and the statusline.
Wallet fields remain unavailable unless the response supplies one consistent currency; missing monthly values are omitted, and an enabled zero cap is shown as zero.

The contract was revalidated on 2026-08-27 against [Pi `c49906ec77788625aacbdc53ebca6fbe65bd20f5`](https://github.com/earendil-works/pi/tree/c49906ec77788625aacbdc53ebca6fbe65bd20f5), including [`kimi-coding.ts`](https://github.com/earendil-works/pi/blob/c49906ec77788625aacbdc53ebca6fbe65bd20f5/packages/ai/src/providers/kimi-coding.ts) and [`auth/oauth/kimi-coding.ts`](https://github.com/earendil-works/pi/blob/c49906ec77788625aacbdc53ebca6fbe65bd20f5/packages/ai/src/auth/oauth/kimi-coding.ts).
It was also revalidated against [Kimi Code `676e4d82240855044fe809fea89ce1dbe8e512cf`](https://github.com/MoonshotAI/kimi-code/tree/676e4d82240855044fe809fea89ce1dbe8e512cf), including [`managed-usage.ts`](https://github.com/MoonshotAI/kimi-code/blob/676e4d82240855044fe809fea89ce1dbe8e512cf/packages/oauth/src/managed-usage.ts) and its [tests](https://github.com/MoonshotAI/kimi-code/blob/676e4d82240855044fe809fea89ce1dbe8e512cf/packages/oauth/test/managed-usage.test.ts).
The pinned Pi source at `e86823096c5bad39e1ca282ec24bc5eb9bec745b` has no changes in either reviewed Kimi file at the selected revision.
The pinned Kimi managed-usage source at `cd7c97b377a77f7ae1b9d541cafe314e986ec074` is an ancestor of that selected revision and has no changes in the reviewed source or tests.

### GitHub Copilot

- Provider ID: `github-copilot`
- Semantics: the allowance reported for the active Copilot plan
- Allowance labels: AI credits for usage-based billing, premium requests for legacy annual billing, or chat requests for Copilot Free
- Source: GitHub's undocumented `GET /copilot_internal/user` endpoint
- Displayed data: entitlement, remaining allowance, percentage, reset time, plan, and any additional usage beyond the included allowance
- Statusline examples: `copilot credits 1200/1500 80%`, `copilot 245/300 82%`, or `copilot chat 40/50 80%`

GitHub's quota endpoint requires the original GitHub OAuth token rather than the short-lived Copilot inference token exposed by runtime auth.
`pi-usage` supports Copilot accounts created through Pi's `/login` flow and named accounts offered by a compatible `oauth:credential-source:v1` owner.
It uses a candidate only when its short-lived access token exactly matches the freshly resolved active runtime credential.
Duplicate equivalent candidates are harmless, while conflicting matches fail closed without choosing by extension load order.
API-key credentials, account mismatches, GitHub Enterprise accounts, and proxy/custom provider origins fail closed.
The detailed report follows the endpoint's `token_based_billing` marker so AI credits are not mislabeled as legacy premium requests.
It reports overage without treating a negative included balance as malformed.

### OpenRouter

- Provider ID: `openrouter`
- Semantics: API-key spend and per-key credit limits—not consumer subscription quota
- Source: OpenRouter's documented [`GET /api/v1/key`](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) endpoint using Pi's resolved inference API key
- Displayed data: key label when safely returned, optional per-key limit and remaining amount, reset period, and daily/weekly/monthly/all-time spend
- Statusline examples: `openrouter $74.50 left` or `openrouter $25.50 used`

The extension does not call OpenRouter's account-level `/credits` endpoint because that operation requires a separate management key.
OpenRouter documents the distinction between credit and rate limits in its [API limits guide](https://openrouter.ai/docs/api_reference/limits).

### DeepSeek API balance

- Provider ID: `deepseek`
- Semantics: current API account balance, not historical usage or quota
- Source: documented `GET https://api.deepseek.com/user/balance` using Pi's freshly resolved runtime API key
- Displayed data: whether API calls are available plus separate total, granted, and topped-up balances for each returned CNY or USD currency
- Statusline examples: `deepseek CNY 110.00` or `deepseek CNY 110.00 · USD 20.00`

The extension queries the fixed balance endpoint only when the selected model origin is `https://api.deepseek.com` and any resolved-auth origin override, when present, has the same official origin.
Pi's built-in DeepSeek API-key resolver does not attach a redundant auth origin, so the validated model origin remains authoritative when no override exists.
Custom and proxy origins fail before network access, redirects are rejected, and only the resolved Bearer credential is forwarded from Pi's runtime auth.
Monetary decimal strings remain exact from the response through display.
CNY and USD stay separate and are never converted or added together.
The balance endpoint does not provide historical spend, request windows, reset times, or aggregate token usage, so `pi-usage` does not claim those DeepSeek capabilities.

The contract was verified on 2026-08-28 against [DeepSeek's Get User Balance documentation](https://api-docs.deepseek.com/api/get-user-balance) and Pi's [`deepseek.ts`](https://github.com/earendil-works/pi/blob/c49906ec77788625aacbdc53ebca6fbe65bd20f5/packages/ai/src/providers/deepseek.ts) at `c49906ec77788625aacbdc53ebca6fbe65bd20f5`.
DeepSeek Harness `cd5ef8148158c3a752a658978873241fdf8e2bbc` reports only per-request model token usage and does not provide account balance data.

### OpenCode Go (Zen)

- Provider ID: `opencode-go`
- Semantics: OpenCode Zen plan usage windows—rolling, weekly, and monthly
- Source: `GET https://opencode.ai/zen/go/v1/usage` using Pi's resolved inference API key
- Displayed data: used percentage and reset time for each window
- Status handling: `rate-limited` windows remain visible, while unknown statuses become unavailable notes
- Statusline examples: `zen 0% r 4% w 2% m`

The fixed endpoint is queried only when the OpenCode Go model uses the official `https://opencode.ai` origin.
When resolved provider auth includes a base URL, that URL must use the same origin.
Other origins fail before the credential is sent.

### xAI consumer subscriptions

- Provider ID: `xai`
- Semantics: consumer subscription allowance and credits, not xAI API-team billing
- Identity route: `GET https://cli-chat-proxy.grok.com/v1/user?include=subscription`
- Billing route: `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- Displayed data: included allowance or legacy monetary limit, period and reset, on-demand spend and cap, prepaid balance, and a sanitized optional plan tier
- Statusline: not published; xAI is queried only through an explicit `/usage` action while xAI usage is enabled

The adapter accepts only the official Pi inference origin `https://api.x.ai` and a freshly resolved bearer that exactly matches one complete Pi OAuth credential.
Pi's reviewed OAuth scope is `openid profile email offline_access grok-cli:access api:access`.
The adapter rejects `XAI_API_KEY`, duplicate or conflicting OAuth candidates, account mismatches, and incomplete OAuth records.
It also rejects custom or proxy-resolved origins before consumer-proxy access.
API-key users can review API-team spend through [console.x.ai](https://console.x.ai/) instead.
The public Management API requires a separate management key and team ID and is intentionally outside this runtime-credential integration.

The identity response supplies a transient proxy-canonical `userId` that is validated and sent as `x-userid` only on the billing request.
The extension sends the matched bearer as `Authorization` plus Grok Build's source-defined non-secret `X-XAI-Token-Auth`, client-version, and interactive client-mode headers.
It does not read Grok Build files, device state, names, email, or other profile fields.
Responses are body-bounded, redirects are rejected, raw identity and billing payloads are not retained, and secrets are redacted from errors.
Included allowance, on-demand usage, and prepaid balance remain distinct because they represent different billing concepts.

The current official Grok Build implementation is the ground truth for the xAI integration contract.
The implementation contract was verified against these first-party revisions:

- Pi [`providers/xai.ts`](https://github.com/earendil-works/pi/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/ai/src/providers/xai.ts) and [`auth/oauth/xai.ts`](https://github.com/earendil-works/pi/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/ai/src/auth/oauth/xai.ts) at `e868230`, revalidated byte-for-byte for those files at [`ccfe79e`](https://github.com/earendil-works/pi/tree/ccfe79ed238674f760c986e3a61493aab794000a).
- Grok Build [`UserInfo`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/auth/model.rs), [`subscription_check.rs`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/agent/subscription_check.rs), [`billing.rs`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/extensions/billing.rs), [`auth/config.rs`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-shell/src/auth/config.rs), [`xai-grok-http`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-http/src/lib.rs), and [`xai-grok-version`](https://github.com/xai-org/grok-build/blob/9684fa3cdbf2995e30ea8b9b637f1db008f144fc/crates/codegen/xai-grok-version/Cargo.toml) at `9684fa3`.
- [xAI Management API team billing boundary at `723dd2a`](https://github.com/xai-org/xai-proto/blob/723dd2aa22d17be35617463837dc47cda008d90e/proto/xai/management_api/v1/billing.proto).

The approved 2026-08-27 protocol smoke used only Pi's OAuth bearer and read no Grok-local files.
A disposable or maintainer account received HTTP 200 without redirects from both routes.
The implementation also sends the non-secret client headers present on both routes in current Grok Build source, with `x-userid` added only for billing.
The sanitized identity shape contained a string `userId` and nullable `subscriptionTier`.
The billing shape contained a `config` object with period and distinct on-demand and prepaid wrappers, without retaining field values.

Disable `xaiUsage` to stop all xAI consumer usage traffic while preserving other provider behavior.

### Z.AI (GLM Coding Plan)

- Provider ID: `zai` and `zai-coding-cn`
- Semantics: GLM Coding Plan quota windows—the rolling 5-hour and weekly plan-usage windows plus the monthly MCP allowance
- Source: the undocumented `GET {origin}/api/monitor/usage/quota/limit` endpoint also used by Z.AI's official coding plugin
- Allowed origins: the model base URL must resolve to `https://api.z.ai` or `https://open.bigmodel.cn`
- Displayed data: explicit used and remaining values, reset times, provider-reported per-tool MCP details, and the reported plan level
- Percentage-only windows remain percent-based
- Statusline: publishes remaining plan percentages such as `zai 87% 5h 76% wk`; monthly MCP details remain available through `/usage`

The monitor endpoint is not a published API contract and may return legacy `TOKENS_LIMIT` or newer `CREDIT_LIMIT` window names.
The extension classifies both forms by the provider's window unit and does not label provider-reported counts as tokens or calls.
The quota monitor expects a raw API key without a `Bearer` prefix.
The extension removes that prefix from resolved authorization before sending it to the monitor endpoint.
Fingerprinting and redaction keep using the original resolved credential.
Only the official `api.z.ai` and `open.bigmodel.cn` origins are queried; other origins fail before sending the credential.

## 🧭 Current and configured accounts

`Current` identifies the provider and credential used by Pi's selected model.
`Configured` identifies runtime auth for another supported provider, not an active provider.

The extension does not enumerate multiple accounts inside one provider and does not switch accounts.
Account selection remains owned by Pi or an account-management extension.
A compatible credential owner may offer the verified active named account through the versioned process-local protocol without exposing its account label or storage.
Without such an owner, `pi-usage` retains its standalone Pi `auth.json` behavior.
An older or incompatible owner degrades to the existing authentication-unavailable result when the stored login does not match runtime auth.
After the active runtime credential changes, the next command, turn, or scheduled refresh resolves auth again and cannot reuse another account's cached report.

## 📊 Statusline behavior

The `usage` status item is active only for selected providers that publish statusline usage.
It refreshes every five minutes while the session remains on such a provider and is cleared when the model changes to an unsupported or menu-only provider.
DeepSeek publishes each returned currency as a separate exact balance segment and reports when the API is unavailable.
xAI is always menu-only and never starts a scheduled status refresh.
Z.AI statusline usage refreshes every five minutes while the selected model remains on Z.AI.

Queries for another provider or all providers never publish their results to the statusline.
`@narumitw/pi-statusline` supplies the default `📊` icon; `pi-usage` publishes text-only values.

## 🔄 Migrating from pi-codex-usage

`pi-codex-usage` is deprecated and its source is archived under `deprecated/`.
To migrate one installation:

```bash
pi remove npm:@narumitw/pi-codex-usage
pi install npm:@narumitw/pi-usage
```

Remove the deprecated package rather than loading both usage extensions together.

Behavior changes:

- Use `/usage` for usage management; `/codex-status` is no longer registered.
- Refresh and cross-provider operations are menu actions rather than flags.
- Codex CLI fallback is removed to preserve active-runtime-account correctness.
- The status key changes from `codex-usage` to `usage`.

## 🔒 Security and privacy

Credential candidates are collected synchronously in memory and are not cached, persisted, logged, formatted, or appended to the Pi session.
The protocol carries no account name or extension identity.
Only the selected provider's exact runtime match is used, and secrets are sent only to its validated official origin.
DeepSeek balance requests require Bearer authentication, send only that resolved credential from Pi's runtime auth to `https://api.deepseek.com/user/balance`, and refuse redirects.
Pi extensions run with the user's process privileges, so the shared event bus is not a security boundary between installed extensions.
Install only trusted extensions because they can read user files and process memory.
Protocol v1 interoperability is characterized for the repository's supported Pi runtime.
An absent or incompatible peer preserves standalone fallback and fail-closed mismatch behavior.

## 🚧 Limitations

- Only providers with a meaningful usage source and verifiable Pi runtime auth are supported.
- GitHub Copilot quota, Kimi managed usage, Z.AI quota, and OpenAI Codex reset redemption rely on provider-owned endpoints that may change without notice.
- Codex reset redemption requires a current ChatGPT OAuth credential from Pi's login or a compatible credential source; Codex API keys cannot redeem earned subscription resets.
- xAI usage supports only a uniquely matched Pi OAuth subscription credential; xAI API keys and Management API credentials are unsupported.
- Credentials resolved for custom provider base URLs are never forwarded to the providers' official usage endpoints; effective auth origin validation requires Pi 0.81.0 or newer.
- Provider reports are snapshots and may themselves be delayed by the provider.
- DeepSeek reports current API balance only; it does not expose historical usage, quota windows, reset times, or account-wide token totals through the balance endpoint.
- OpenRouter successful inference responses do not expose proactive request-rate counters; `/usage` reports the documented per-key credit/spend fields instead.
- A provider may not return a safe human-readable account identity.
  In that case the provider and runtime credential state remain visible without exposing secrets.
- Immediate account-change events are not available from Pi; auth is re-resolved before commands, turns, and scheduled refreshes.
- Fast model support is intentionally conservative and may require an extension update when Codex adds or removes service tiers.
- Another later-loaded extension can replace the final provider payload, so arbitrary third-party payload-rewrite conflicts cannot be prevented.

## 🗂️ Package layout

```txt
packages/pi-usage/
├── dist/                  # Generated TypeScript runtime loaded by Jiti
├── scripts/
│   └── build-runtime.mjs  # Deterministic runtime builder and boundary validator
├── src/
│   ├── index.ts       # Pi package entrypoint and helper export barrel
│   ├── usage.ts       # Menu, cache, and usage lifecycle orchestration
│   ├── usage-settings-ui.ts # Pi SettingsList interaction and save rollback
│   ├── codex-fast.ts  # Fast eligibility, request tier, and cost correction
│   ├── codex-fast-runtime.ts # Fast command, persistence lifecycle, and request hooks
│   ├── settings.ts    # Validated user settings and atomic persistence
│   ├── usage-helpers.ts # Small orchestration helpers
│   ├── query.ts       # Runtime auth resolution and bounded provider queries
│   ├── oauth-credential-source.ts # Ephemeral OAuth candidate collection
│   ├── codex-resets.ts # Codex reset auth, API contracts, and normalization
│   ├── format.ts      # Provider-aware notifications and statusline text
│   ├── core.ts        # Cache, concurrency, fingerprint, and redaction helpers
│   ├── providers/     # Provider-specific usage normalization adapters
│   └── types.ts       # Common presentation and adapter contracts
├── test/
├── README.md
├── LICENSE
├── tsconfig.json
└── package.json
```

`index.ts` is the Pi entrypoint and forwards the default factory from `usage.ts` while retaining the package's named helper exports; other source modules are internal.

The generated runtime is built from the authoritative `src/index.ts` graph and does not import back into `src`.

## 🔎 Keywords

Pi extension, Pi coding agent, usage, quota, DeepSeek API balance, DeepSeek balance, OpenAI Codex usage, ChatGPT subscription limits, Kimi For Coding, Kimi Coding Plan usage, GitHub Copilot AI credits, GitHub Copilot premium requests, OpenRouter credits, xAI OAuth usage, Grok subscription allowance, API-key spend limits, TypeScript Pi package, npm Pi extension.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
