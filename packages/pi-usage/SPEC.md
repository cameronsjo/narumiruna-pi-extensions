# Z.AI statusline usage

This specification defines the Z.AI statusline behavior for Pi extension users and maintainers.
It applies to the `zai` and `zai-coding-cn` providers in `pi-usage`.

## Observable behavior

When the selected model uses the `zai` or `zai-coding-cn` provider and a usage query succeeds, the usage statusline displays the remaining percentages for the available plan windows.

The statusline starts with `zai` and lists the five-hour window before the weekly window.
The five-hour window uses the `5h` label and the weekly window uses the `wk` label.

For example, a report with 87% remaining in the five-hour window and 76% remaining in the weekly window displays:

```text
zai 87% 5h 76% wk
```

The displayed percentages are rounded to whole numbers.
A count-based window derives its remaining percentage from its remaining and limit values.
A percentage-based window uses its reported remaining percentage.

A missing or unusable window is omitted without preventing another usable window from appearing.
If neither the five-hour nor weekly window is usable, the usage statusline is cleared.
Monthly MCP allowance and per-tool MCP details are shown by `/usage` and are not included in the statusline.

For the selected Z.AI model, the statusline refreshes through the existing five-minute usage refresh cycle.
Manual queries for another provider or all providers do not publish a statusline value.
