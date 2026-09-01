---
"@narumitw/pi-usage": minor
---

Add Z.AI plan support: query the undocumented `GET {origin}/api/biz/subscription/list` plan endpoint after the quota windows and report the GLM Coding Plan name and renewal date, falling back to the quota response's plan level when the plan endpoint is unavailable. Z.AI percentage windows now render usage bars in `/usage`, matching the Codex report. Z.AI window lengths and the session label derive from the payload's `(unit, number)` window pair instead of hardcoded constants, with the previous 5-hour and weekly values as fallbacks.
