# ai_billing

## What it is

Part of billing: meters and charges for AI usage across the product — plan
allowances, prepaid credits, and post-paid overage for AI usage, priced at
provider cost (plus markup for overage).

## Start here

- `src/lib.rs` doc comment: the pricing model (free/premium/max allowances,
  overage markup) and the cost-cents vs. customer-cents unit split — read
  before touching any number.
- `src/domain/pricing.rs` + `src/config.rs`: `AiPricing`, built once at
  startup from mandatory Doppler values.
- `src/domain/admission.rs`: `AiAdmissionService` — the pre-call gate
  (`ai_trigger`, etc. depend on this).
- `src/domain/ledger.rs` + `src/domain/sweep.rs`: the credit/overage ledger
  and the settlement sweep.
- `src/outbound/stripe_gateway.rs`: the only place Stripe is called.

## Scope

- Owns: pricing, admission (can this call happen), and settling charges.
- Not here: per-call token/cost tracking → `ai_usage` (this crate reads it
  via `pg_usage_reader.rs`, never recomputes it).

## Boundaries

- Depends on: `ai_usage` (usage reader port).
- Used by: `agent_harness_service`, `document_cognition_service`,
  `agent_trigger_service`, `document_storage_service`,
  `authentication_service`, `mcp_service`, `scheduled_action`, `ai_tools`,
  `agent_session`, `agent_trigger`, `agent_inmem`, `channel_bots`, `memory`,
  `documents`, `anthropic`, `import`.

## Recipes

- Change a pricing number: Doppler (never hardcode) → `src/config.rs` →
  `src/domain/pricing.rs`.
- Add an admission check: `src/domain/admission.rs` → `src/inbound/admission.rs`.
- Grant a user credit (operator refund): `tooling/ai_billing_cli` →
  `src/domain/credit_grant.rs` → `src/outbound/pg_credit_grant_repo.rs`.

## Checks

- `cargo test -p ai_billing` (`SQLX_OFFLINE` unset).

## Gotchas

- Usage is cost cents; credits/charges/caps/packs are customer cents — only
  `AiPricing`'s conversions cross that boundary; never multiply/compare the
  two directly.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
