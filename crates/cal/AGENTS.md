# cal

## What it is

Part of Calendar: receives cal.com booking-event webhooks and fires
analytics events in response. Macro's own calendar/booking domain lives in
`calendar_events`/`calendar_scheduling`; no other consumers of this crate
in the workspace yet.

## Start here

- `src/domain/service.rs` + `src/domain/models.rs`: webhook event parsing and policy.
- `src/inbound/cal_webhook_router.rs`: HTTP router validating and dispatching
  cal.com webhook signatures (feature `axum`).
- `src/outbound/analytics_client.rs`: analytics sink adapter (feature `outbound`).

## Scope

- Owns: cal.com webhook signature verification and the booking→analytics-event
  mapping.
- Not here: Macro's own calendar/booking domain → `crates/calendar_events`,
  `crates/calendar_scheduling`.

## Boundaries

- Depends on: `analytics_client` (feature `outbound`), `axum`/`utoipa`/`model-error-response`
  (feature `axum`).
- Used by: `services/document_storage_service`, its composition root.

## Recipes

- Handle a new cal.com event type: `src/domain/models.rs` (event variant) →
  `src/domain/service.rs` → `src/inbound/cal_webhook_router.rs`.

## Checks

- `cargo test -p cal` (`SQLX_OFFLINE` unset).

## Gotchas

- Webhook signature verification uses HMAC-SHA256 (`hmac`/`sha2`) over the raw
  body; don't re-serialize the payload before verifying.

## Related

- Rules: `.agents/rules/rust/architecture.md`
