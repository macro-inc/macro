# dialpad_sync

## What it is

Part of Calls: imports a user's Dialpad phone calls (details, transcript, AI
recap; never audio) as private Macro calls. The Dialpad grant lives in Macro
Connect, a separate service (`macro-inc/macro-connect`) this crate reaches
through `connect_client`; this crate owns only the sync.

## How it works

The user connects from Settings: `POST /integrations/dialpad/connection`
enrolls them and returns a Macro Connect URL; Connect returns them to
`/app/settings/connections`, and `.../complete` (or the next 30-second
reconcile) reads `users/me`, registers a webhook with a secret Macro chose,
and subscribes to that user's call states. Dialpad posts HS256 JWTs to
`/integrations/dialpad/webhooks/{id}`; each verified event is stored with
its `traceparent`. The worker leases a call's pending events together, so
one import covers them: it rebuilds the call from all of its events, fetches
the transcript, and ingests through `call::domain::imports`.
A first-connect backfill pages `GET /call` one page per reconcile.

## Start here

- `src/domain/service.rs`: setup, delivery intake, the worker tick.
- `src/domain/mapping.rs`: events → one `ImportedCall` snapshot.
- `src/outbound/pg_repo.rs`: enrollment, setup leases, delivery dedup.

## Scope

- Owns: Dialpad webhook lifecycle, delivery verification and dedup, call
  mapping, backfill.
- Not here: the Dialpad OAuth grant → Macro Connect (`macro-inc/macro-connect`); call
  storage → `crates/call`; CRM linking → `crates/crm` (consumes the
  `call.record_imported` event).

## Boundaries

- Depends on: `call` import port, `connect_client`, `phone_number`,
  `row_cipher`, `macro_tower_layers` (stored trace context).
- Used by: `services/agent_harness_service` (composition, routes, worker).

## Checks

- `cargo test -p dialpad_sync` (DB tests; leave `SQLX_OFFLINE` unset)

## Gotchas

- Imports replace the stored call wholesale, so a snapshot must always be
  built from every stored event of the call, never only the triggering one.
- Dialpad sends no event id: deliveries dedupe on (call, state, timestamp).
- `GET /call/{id}` is limited to 10/min and `ai_recap` to 12/min; live calls
  use event payloads, and only backfill reads the recap endpoint.
- Always pass `target_type=user`: without a target an admin's token lists or
  subscribes to the whole company. Dialpad allows 100 call subscriptions per
  company across all integrations.
- Dialpad only delivers to public HTTPS; setup is a no-op without one
  (local stacks need a tunnel on `/cognition/integrations/dialpad/webhooks`).
- Disconnecting deletes Macro Connect's connection; it does not revoke the
  grant at Dialpad. Imported calls stay, and the sync row stays (as
  `Disconnected`) so a reconnect keeps its import namespace: never delete it,
  or a backfill re-imports calls as duplicates.
- Deliveries are stored only while a sync runs or is mid-setup; a stopped
  sync's subscription may keep posting.
- Needs `CONNECT_CUSTOMER_KEY` and a live `dialpad` app in Macro Connect
  (`registry/apps/dialpad` in `macro-inc/macro-connect`, an `own_app` awaiting
  Dialpad's approval).

## Related

- Docs: `docs/agent-guide/calls.md` (Imported calls)
