# ai_usage

## What it is

Part of billing: a robust log of AI usage with cost computed from model id
and token counts (or audio duration), feeding `ai_billing`'s admission and
ledger decisions, plus a flexible admin query API.

## Start here

- `src/lib.rs` doc comment: the layering (`domain`/`outbound`/`inbound`)
  and the split between best-effort analytics tracking and the awaited,
  fail-closed `FinancialUsage` capability for billable traffic.
- `src/domain/financial.rs` + `src/domain/financial_service.rs`: immutable
  provider cost evidence and exact customer-money calculation.
- `src/domain/tracking.rs`: `UsageTracking` — the always-recorded log, used
  for analytics regardless of billing status.
- `src/domain/counting.rs`: `is_billable_feature` and the
  `NON_BILLABLE_AI_FEATURES` allowlist.
- `src/outbound/pg_usage_repo.rs`, `pg_tracking_repo.rs`,
  `pg_financial_usage_repo.rs`: the Postgres adapters.

## Scope

- Owns: pricing a model invocation and logging usage/cost.
- Not here: plan allowances, credits, and settlement → `ai_billing` (reads
  this crate's financial usage, never recomputes cost itself).

## Boundaries

- Depends on: none notable outside the workspace-hack set.
- Used by: `agent`, `agent_session`, `agent_harness`, `agent_trigger`,
  `ai_billing`, `ai_tools`, `ai_projections`, `anthropic`, `call`,
  `documents`, `import`, `image_generation`, `memory`, `channel_bots`,
  `agent_inmem`, `dictation`, `task_dedup`, `jev`.

## Recipes

- Price a new model: `src/domain/financial.rs` (rate entry) →
  `src/config.rs` (if a new Doppler-sourced rate) → test in
  `src/config/test.rs`.
- Mark a feature non-billable: `src/domain/counting.rs`'s
  `NON_BILLABLE_AI_FEATURES`.

## Checks

- `cargo test -p ai_usage` (`SQLX_OFFLINE` unset).

## Gotchas

- `UsageRecorder` (analytics) is best-effort and never fails the
  originating call; `FinancialUsage` (billable) is awaited and fail-closed
  — don't conflate the two when adding a new recording path.
- Read prices from the `ai_effective_pricing` view, never `ai_pricing`
  directly: it applies `ai_pricing_discount`, a per-model input and output
  percent off (input's also covers cache and audio rates). Gemini 3.8 Flash
  is discounted to DeepSeek V4.1 Flash's $0.30 / $1.20.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
