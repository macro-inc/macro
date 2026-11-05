# AI provider alerts

Runbook for the AI provider account and spend monitors in
[`monitors/ai-providers.ts`](../../infra/stacks/monitoring/monitors/ai-providers.ts).
Every alert links the **AI providers** dashboard.

Macro calls each provider with one account key per provider. When a provider
suspends that account or it runs out of credit, every request on that provider
fails until someone fixes billing; retries and model fallbacks do not help.

| What | Search |
| --- | --- |
| Refused requests, Rust services | Logs: `"ai provider account unavailable"`, grouped by `@provider` and `@reason` |
| Refused requests, AI editing worker | Spans: `resource_name:ai.provider_account_unavailable`, grouped by `@ai.provider` |
| Priced spend per call | Logs: `"ai usage priced" @provider:<provider>`, summing `@cost_usd` |

## Account suspended or out of credit

A provider answered a request made with Macro's key with a suspension
(`suspended`: e.g. Fireworks' `412 Account … is suspended`, OpenAI's
`account_deactivated`) or a billing refusal (`out_of_credit`: HTTP 402,
Anthropic's low credit balance or usage limit, OpenAI's `insufficient_quota`).
Rate limits do not count. Requests made with an agent's own API key do not
count either: that is the agent owner's billing.

- Open the provider's billing console and read why: unpaid invoice, prepaid
  credit used up, or the monthly spending limit reached.
- Levers: pay the invoice, add credit, or raise the limit. Raising a capped
  provider's limit also means updating `MONTHLY_CAPS` in `ai-providers.ts`.
- Until it is fixed, models on that provider fail. Users can pick another
  model; the AI editing worker falls back along its chain on its own.
- The alert recovers five minutes after the last refused request.

## Spend nearing or at a cap

Priced spend on a provider with a monthly cap has passed 50% (warning), 80%
(critical) or 100% of that cap this calendar month. At the cap the provider
suspends the account and the alert above fires.

- Priced spend is Macro's estimate: tokens from each call times the
  `ai_pricing` rate. The provider's console is the source of truth; check it
  before acting.
- Spend is summed across environments, since one account serves dev and prod.
- Levers: raise the cap in the provider's console and in `MONTHLY_CAPS`, or
  find what is spending (`"ai usage priced" @provider:<provider>`, grouped by
  `@model` and `service`).
- Only providers with a documented cap have these monitors; today that is
  Fireworks ($30 a month).
