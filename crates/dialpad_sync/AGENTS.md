# dialpad_sync

## What it is

Part of Calls: imports a user's Dialpad phone calls (details, transcript, AI
recap; never audio) as private Macro calls. The Dialpad grant lives in Macro
Connect (`macro-inc/macro-connect`), reached through `connect_client`; this
crate owns only the sync.

## How it works

Settings `POST /integrations/dialpad/connection` enrolls the user and returns a
Macro Connect URL; Connect returns them to `/app/settings/connections`.
`.../complete` (polled by the row) or the 30-second reconcile then
reads `users/me`, registers a webhook with a secret Macro chose, and subscribes
to that user's call states. Dialpad posts HS256 JWTs to
`/integrations/dialpad/webhooks/{id}`; each verified event is stored with its
`traceparent`. The worker leases a call's pending events together, rebuilds
the call from all of its events, fetches the transcript, and ingests through
`call::domain::imports`. Backfill pages `GET /call` one page per reconcile.

## Start here

- `src/domain/service.rs`: setup, delivery intake, the worker tick.
- `src/domain/mapping.rs`: events → one `ImportedCall` snapshot.
- `src/outbound/pg_repo.rs`: enrollment, setup leases, the event queue.

## Scope

- Owns: Dialpad webhook lifecycle, delivery verification and dedup, call
  mapping, backfill.
- Not here: the OAuth grant → Macro Connect; call storage → `crates/call`; CRM
  linking → `crates/crm` (consumes `call.record_imported`).
- Used by: `services/agent_harness_service` (routes, worker), only when
  `CONNECT_CUSTOMER_KEY` is set.

## Checks

- `cargo test -p dialpad_sync` (DB tests; leave `SQLX_OFFLINE` unset)

## Gotchas

- An import replaces the stored call wholesale, so build it from every stored
  event of the call, and never import without a transcript Dialpad could not
  serve: that deletes the stored one (only 403/404 mean none).
- Stopping or disconnecting drops a sync's pending events; a call's events
  are forgotten once it has been done and quiet for 30 days.
- Setup success and failure must match the lease that stored the secret. A
  registration activation did not record is retired before returning; setup
  first removes one a stopped sync left behind, and keeps its ids if that
  fails, so a sync never has two live subscriptions.
- Fence asynchronous grant checks and backfill commits on the observed
  enrollment (and cursor): a reconnect may land meanwhile.
- A call with an active lease cannot be claimed again, even for new events;
  before ingesting, `holds()` re-checks the lease, so a stop or disconnect
  during the fetch skips the import while a reconnect keeps it.
- Call failures are read from pending events, never `last_error`. A call that
  gives up parks at `available_at = 'infinity'` until a new event for it
  starts its attempts over.
- Dialpad sends no event id: deliveries dedupe on (call, state, timestamp).
  Signatures are checked before reading; a signed event that does not decode
  is acknowledged and dropped, logging ids and the field path, never content.
- Always pass `target_type=user`, or an admin's token lists or subscribes to
  the whole company (which allows 100 call subscriptions across all
  integrations). Only events whose `target.id` is the connected Dialpad user
  import, checked on receipt, on backfill pages and again at import.
- `ai_recap` allows 12 calls a minute, so only backfill reads it; live calls
  take their recap from events.
- Dialpad delivers only to public HTTPS; locally, tunnel
  `/cognition/integrations/dialpad/webhooks`.
- Disconnecting keeps the row and its import namespace, so a reconnect never
  duplicates calls; never delete it.

## Related

- Docs: `docs/agent-guide/calls.md` (Imported Dialpad calls)
