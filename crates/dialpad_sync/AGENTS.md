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
A first-connect backfill pages `GET /call` one page per reconcile; backfills
take turns, a failed page backs off (30 seconds, doubling to an hour), and an
unreadable item is skipped and logged by call id and field path.

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
  Events can be sparse: details merge field by field, newest value first.
- Setup success and failure must both match the lease that stored the secret.
  If activation fails, retire the newly created registration before returning.
- Backfill commits must match the enrollment and cursor read before fetching.
- Grant checks may finish after a reconnect: stop/flag only the observed enrollment.
- A call with an active delivery lease cannot be claimed again, including newly
  arrived events; concurrent claims serialize briefly on the connection row.
- Dialpad sends no event id: deliveries dedupe on (call, state, timestamp).
- The signature is checked before the event is read. A bad one is a 401; a
  signed event that does not decode, or has no timestamp, is acknowledged and
  dropped (refusing only makes Dialpad resend it), logging ids and the field
  path, never content. Fields Dialpad sends in more than one shape decode in
  `models::lenient`; events are stored in the declared shape.
- Call failures are read from pending events, never stored in `last_error`,
  so one call's success cannot hide another's failure. A call retries with
  backoff `MAX_CALL_ATTEMPTS` times, then waits at `available_at = 'infinity'`
  (Settings: "Some calls not imported") until a new event for it starts its
  attempts over.
- Only a rejected token (401) fails a transcript fetch; any other error
  imports the call without its transcript, as 403/404 do.
- `GET /call/{id}` is limited to 10/min and `ai_recap` to 12/min; live calls
  use event payloads, and only backfill reads the recap endpoint.
- Always pass `target_type=user`: without a target an admin's token lists or
  subscribes to the whole company. Dialpad allows 100 call subscriptions per
  company across all integrations.
- An import makes the connected user the call's owner, so only events whose
  `target.id` is that Dialpad user import. Others, and events with no target,
  are dropped on receipt, on backfill pages, and again at import (deliveries
  that arrive mid-setup are stored before the user is known).
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
