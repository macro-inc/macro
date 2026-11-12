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
- `src/domain/invite_reward.rs`: the invite/referral reward — $10 prepaid
  credit for a paid user's payer, or +$10 monthly free allowance (capped at
  +$50, table `ai_free_allowance_bonus`) for a free user.

## Scope

- Owns: pricing, admission (can this call happen), and settling charges.
- Not here: per-call token/cost tracking → `ai_usage` (this crate reads it
  via `pg_usage_reader.rs`, never recomputes it).

## Boundaries

- Depends on: `ai_usage` (usage reader port). Team membership arrives
  through the `TeamSeats` port (`src/domain/team_seats.rs`), never the
  `teams` crate: roots pass `teams::outbound::team_repo::TeamRepositoryImpl`
  with `teams`' `ai_billing` feature, which also serves teams'
  `OpenSeatRelease` from `BillingServiceImpl`.
- Used by: `agent_harness_service`, `document_cognition_service`,
  `agent_trigger_service`, `document_storage_service`,
  `authentication_service`, `mcp_service`, `scheduled_action`, `agent_tools`,
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
- `ai_credit_reload` holds both card-on-file charges: `kind = 'automatic'`
  reloads and `kind = 'purchase'` one-time buys (with `purchased_by`). Both
  count against the payer's monthly limit; automatic retries, orphan sweeps,
  and auto-reload suspension must stay scoped to `automatic`.
- A voided purchase is `failed` with `stripe_invoice_id` cleared, so limit,
  retry, and sweep queries (which count failed rows only with an invoice)
  ignore it without a separate status.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
