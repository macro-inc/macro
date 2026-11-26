# granola_sync

## What it is

Imports Granola meeting notes as private Macro calls. Sync follows the user's
Granola connection, as the `connectors` services count it; there are no user
controls or user routes.

## How it works

The worker (`inbound::run_worker`) reconciles every 30 seconds: each user
whose Granola connection gives API access (`ApiConnectionsService::holders`)
gets one webhook at the widest scope the key accepts (`All`, falling back to
`Workspace`), and syncs whose connection went away are stopped. Granola posts
signed events to the public webhook route; they are stored durably, then
leased, fetched through `ApiConnectionsService::call`, and ingested through
`call::domain::imports`. A user connecting Granola starts their sync over at
once (`inbound::connected_hook`, on the `/connectors` connect hook), and
reconcile keeps a holder whose connection could not be resolved: `holders`
fails rather than leave them out, so nothing is stopped on an outage.

Webhooks only bring new activity, so each enabled sync also backfills the
notes the key can already see (`SyncService::backfill`): the worker leases one
page of `GET /notes` at a time while no delivery waits, fetches each live note
through the same adapter and mapper as a delivery, ingests it, and saves the
next cursor. A failed page retries from its saved cursor with backoff; after
`BACKFILL_PAGE_ATTEMPTS` the notes that still fail are skipped so history is
not blocked. A 429 (`RateLimited`) is not a failure: the page stops, waits a
minute and keeps its attempt. Restarting sync (a connect) starts the backfill over.

## Start here

- `src/domain/service.rs`: `plan` decides start/stop; `start` handles scope fallback.
- `src/outbound/pg_repo.rs`: reservation, leases, backfill cursors, and encrypted signing secrets.

## Scope

- Owns: webhook lifecycle, delivery verification and deduplication, history backfill, Granola note mapping.
- Not here: call storage and reads → `crates/call`; which Granola connection counts and how it is called → `crates/connectors`.

## Boundaries

- Depends on: `call` import port, `connectors` `ApiConnectionsService` (tests use its `FakeConnectors`).
- Used by: `services/agent_harness_service` (composition root, worker, webhook route).

## Checks

- `cargo test -p granola_sync` (DB tests; leave `SQLX_OFFLINE` unset)

## Gotchas

- Granola only accepts public HTTPS webhook URLs, built from the harness `MCP_CLIENT_PUBLIC_URL`;
  reconcile is a no-op otherwise. Local stacks need a tunnel on
  `/cognition/integrations/granola/webhooks`.
- Granola discards a delivery permanently on 401 or other 4xx; return 503 while
  setup is still in flight so it retries.
- `namespace` must survive reconnects: it is the import identity in
  `call_entity_sources`, so re-registering never duplicates calls.
- Never log provider response bodies; webhook registration returns the signing secret.
- Backfill and webhooks may import the same note; both use the connection's
  `namespace` and the note ID, so the call import upserts one call. Deleted
  notes are skipped and private scratch notes are never imported, on both paths.
- Granola lists only notes with a generated summary, newest first, at most 30
  per page, and allows 5 requests a second; backfill paces notes at 500 ms
  (two or more requests each).
- Sync is off for users on Macro Connect: Connect holds Granola as MCP only, so
  their connection gives no API access and they are not holders.
- The connectors services name no account, so reconcile cannot see a
  reconnect to a different Granola account; the connect hook restarting the
  sync is what moves the webhook. `account_id` on `granola_sync_connections`
  only keeps older rows' values.

## Related

- Docs: `docs/agent-guide/calls.md` (Imported Granola meetings)
