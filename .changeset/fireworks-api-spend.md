---
"@narumitw/pi-usage": minor
---

Add Fireworks rated API spend reporting for the official fireworks provider, summarizing the trailing 30 days of rated costs per currency with serverless, dedicated-deployment, and training subtotals from the documented billing summary endpoint.

The account slug is discovered through the documented account listing when exactly one account is visible; keys that can see several accounts set `fireworksAccountId` in `pi-usage.json`. Fireworks exposes no credit-balance or spend-cap endpoint, so the report claims only rated spend.
