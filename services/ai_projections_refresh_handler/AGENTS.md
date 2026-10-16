# ai_projections_refresh_handler

## What it is

Part of the AI projections feature (cached AI-generated views of a user's
data, e.g. a dashboard widget) — a scheduled Lambda that sweeps
`ai_projection` instances for one refresh cadence: deletes inactive ones and
enqueues a refresh for stale ones.

## Start here

- `src/event.rs`: `RefreshCadence` and the EventBridge payload shape (a
  constant `{"refresh_cadence":"high"}` per scheduled rule — not the usual
  EventBridge envelope).
- `src/refresh.rs`: the whole sweep — delete/claim decision rules in the module
  doc comment, all SQL lives here.
- `src/main.rs`: composition root (db pool, SQS client, `context::Context`).

## Scope

- Owns: the periodic sweep deciding delete/refresh/leave for
  `user_ai_projection` rows and enqueuing refresh messages via
  `macro_queues::AiProjectionQueue`.
- Not here: materializing a projection's result — that's the queue consumer.

## Recipes

- Change delete/refresh thresholds or add a decision rule: `src/refresh.rs`
  (SQL + doc comment) → `src/refresh/test.rs`.
- Add a field to the EventBridge payload: `src/event.rs` → the EventBridge rule
  definition in `infra/`.

## Checks

- `cargo test -p ai_projections_refresh_handler` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/db.md`
