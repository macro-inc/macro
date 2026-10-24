# whatsapp_linked

## What it is

Personal WhatsApp accounts linked as devices: owner-bound pairing, adopting an
existing group as the adopter's own, independently shared `WhatsAppGroup`
entity (one per owner and WhatsApp group, named after WhatsApp), ingesting group traffic, and
deliberate sends from each person's own account. DSS serves the HTTP API
(`/meta/linked/*`); the WhatsApp session service calls
`domain::session::SessionService` in-process. They share no HTTP: only MacroDB
rows and `NOTIFY` (the `outbound::pg` notify helper).

## Start here

- `src/domain/service.rs`: DSS use cases and send eligibility.
- `src/domain/session.rs` + `src/domain/events.rs`: the session-service API and
  its event types (no whatsmeow types).
- `src/domain/effects.rs`: notification outbox drained by DSS.
- `src/outbound/pg/ingest.rs`: canonical identity `(binding, person, source id)`,
  quarantine, deferral and the standalone message write.
- `src/outbound/pg/sends.rs`: enqueue, claim, dispatch fence, outcome. A
  repeated intent key returns the stored send before any other check.
- `src/outbound/pg.rs` `signals`: JSON `NOTIFY` payloads with `traceparent`
  (`src/outbound/trace_context.rs`). Every write a page shows calls
  `notify_change` (`whatsapp_changed`); DSS pushes it to viewers. Roster writes
  signal only real changes (`groups.rs` `same_facts`).
- Migrations: `crates/macro_db_client/migrations/20261024000000_whatsapp_linked.sql`,
  then `20261024001100_whatsapp_personal_groups.sql`.

## Boundaries

- Depends on: `entity_access` (group receipts, authorizer), `entity_access_db_utils`
  (ordinary grants), `entity_registry_db_utils`, and `share_permission_db_utils`.
- Used by: DSS (`src/whatsapp_linked.rs` composition), the session service.

## Checks

- `cargo test -p whatsapp_linked --all-features` (`SQLX_OFFLINE` unset).
- Check `--no-default-features --features ports` and `inbound` independently; domain dependencies must be enabled by `ports`, not only by the Postgres adapter.

## Gotchas

- Only the connection owner sends or uploads, using their session or own API credential; bot/harness/internal principals never send. Pairing reads and account/access controls require a human session. Preserve verified Macro API JWT origin even without agent attribution.
- Deliberate sends consume a shared per-user request budget (one per second across all groups and DSS replicas); DSS supplies the Redis-backed `SendRateLimiter`. Exhaustion returns HTTP 429 with `Retry-After: 1`; counter failure fails closed.
- Lock accounts before groups, then child rows; lock every group in a batch in UUID order. Pairing expiry locks affected accounts before pairing rows. Media completion takes the group lock before attachment/message writes.
- Every session-service write takes the account row lock at the caller's
  `lease_epoch`; `LinkedError::Fenced` means stop the account now.
- `dispatch_started_at` is written before submission. A dispatched send without
  an outcome becomes `unknown` on takeover and is never resent; a later echo
  with its `allocated_source_id` settles it.
- Bot view receipts can read a known shared group, but never borrow an acting user's phone, send records, or unread cursor.
- View access uses ordinary `entity_access` grants (people, teams, and channels
  through mentions) and link/team sharing, independent of WhatsApp membership;
  `whatsapp_group_can_view` must resolve the same sources as `entity_access`. Only the adopter receives an owner grant; use the generic
  direct-access endpoints to share with people.
- `src/domain/timeline.rs` and `src/domain/service/timeline.rs` own list/detail,
  timeline, unread and sharing use cases. Group HTTP paths are
  `/meta/linked/whatsapp-groups/{group_id}`. Soup/search are deferred.
- Store messages/reactions/attachments in `whatsapp_group_message`,
  `whatsapp_group_reaction`, and `whatsapp_group_attachment`; never native comms tables.
- Attachment bytes cross Postgres (`whatsapp_media_blob`, ≤ 32 MiB) because the
  session service has no document storage; DSS imports and deletes them.
  `events::Media::locator` is sealed by the session service; never read it.
- `src/domain/media.rs` + `src/outbound/pg/media.rs`: download claims, import
  queue. Not implemented: participant-receipt UI.

## Related

- Docs: `docs/architecture/whatsapp-linked-devices.md` · Rules: `.agents/rules/observability.md`
