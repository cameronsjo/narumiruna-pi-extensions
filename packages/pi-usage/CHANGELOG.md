# @narumitw/pi-usage

## 0.57.0

### Minor Changes

- 5c4f8ec: Remove the xAI usage setting and always offer xAI OAuth subscription reporting through explicit `/usage` actions without background or statusline requests.
- ac72cb1: Show compact Codex reset countdowns in the statusline by default, with a setting to restore the legacy window labels.

## 0.56.0

### Minor Changes

- bcb8197: Add exact DeepSeek API balance reporting for official runtime API keys.

## 0.55.0

### Minor Changes

- 948affd: Publish Z.AI remaining five-hour and weekly plan percentages in the statusline.

## 0.54.0

### Minor Changes

- c00bcfe: Add source-backed Kimi For Coding plan-window and booster-wallet usage reporting.
- 2681749: Add default-enabled xAI OAuth subscription usage reporting based on the official Grok Build implementation.
  
  xAI API-key accounts remain unsupported and are directed to the xAI console.

## 0.53.0

### Minor Changes

- bfb415e: Add Z.AI (GLM Coding Plan) usage support for the official zai and zai-coding-cn providers, reporting explicit used and remaining values for the rolling 5-hour and weekly plan windows, monthly MCP allowance with per-tool details, reset times, and the plan level.

## 0.52.3

### Patch Changes

- d74a181: Use the canonical OpenCode Go usage endpoint regardless of the selected model's base URL.

## 0.52.2

### Patch Changes

- 42e8940: Allow current-account consumers to verify named OAuth credentials through a process-local protocol, including GitHub Copilot usage and OpenAI Codex reset flows.

## 0.52.1

### Patch Changes

- 30bc076: Load each extension from a generated TypeScript runtime to reduce Jiti package startup work while preserving existing first-use boundaries.

## 0.52.0

### Minor Changes

- ab49f5b: Add OpenCode Go Zen usage reporting for rolling, weekly, and monthly quota windows.

## 0.51.0

### Minor Changes

- e71cf31: Add persistent OpenAI Codex Fast routing with a `/fast` shortcut, a contextual `/usage` toggle, explicit usage guidance, and effective statusline labeling.

## 0.50.0

### Minor Changes

- a5b0feb: Add safe redemption of earned OpenAI Codex usage-limit resets for the current matching Pi OAuth account.

### Patch Changes

- Updated dependencies [2d79365]
  - @narumitw/pi-tui-kit@0.50.0
