# crates/billing

## What it is

Billing: AI usage metering and quota admission (`ai_usage`, `ai_billing`, which talks to Stripe) and referrals.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`ai_admission`](ai_admission/AGENTS.md) | AI billing: the admission port (`AiAdmissionService`) that gates user-owned AI work, its public errors (`AiAdmissionError`, `DenyReason`) and their HTTP contract. |
| [`ai_billing`](ai_billing/AGENTS.md) | Part of billing: meters and charges for AI usage across the product — plan allowances, prepaid credits, and post-paid overage for AI usage, priced at provider cost (plus … |
| [`ai_usage`](ai_usage/AGENTS.md) | Part of billing: a robust log of AI usage with cost computed from model id and token counts (or audio duration, or provider credits a vendor such as Tavily bills) … |
| [`referral`](referral/AGENTS.md) | Part of the billing feature (referrals). |

## Recipes

- Add a crate here: create `crates/billing/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
