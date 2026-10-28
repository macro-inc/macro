# model_notifications

## What it is

Part of the notifications feature. Wire models for every notification kind
Macro sends: metadata payloads, the digest state machine, device/unsubscribe
types.

## Start here

- `src/lib.rs`: `NotificationTemporalData` and the full re-export list of
  metadata types — the fastest way to see every notification kind that exists.
- `src/metadata.rs` + `src/metadata/`: one metadata struct per notification
  kind (channel, CRM discussion, initiative discussion, GitHub PR, reminder, …).
- `src/metadata/channel_push.rs`: channel push destinations, including the known
  thread root so clients can open directly without fetching notification metadata.
- `src/digest_state.rs`: the digest batching state machine.
- `src/device.rs`, `src/unsubscribe.rs`: device type and per-user unsubscribe.

## Scope

- Owns: the typed payload for each notification kind and digest/unsubscribe
  state. Not the decision of *who* gets notified or delivery — those are
  `notification`/`notification_service`.

## Boundaries

- Depends on: `macro_user_id`, `mention_utils`, `model-entity`, `model_owner`,
  `models_pagination`, `notification`, `invite_email`.
- Used by: `agent_harness`, `ai_tools`, `authentication_service`,
  `calendar_events`, `channels`, `complete_graph`, `document_cognition_service`,
  `document_storage_service`, `email_formatting`, `email_service`, `github`,
  `graphql_notification`, `graphql_work_feed`, `messages`, `notification_db_client`,
  `notification_service`, `properties`, `reminders`, `teams`, `work_feed`.

## Recipes

- Add a new notification kind: new struct in `src/metadata/<area>.rs` (or
  `src/metadata.rs` for a small one) → re-export from `src/lib.rs` →
  `notification_service` (dispatch) → `notification_db_client` (storage).

## Checks

- `cargo test -p model_notifications` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
