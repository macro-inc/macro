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
`call::domain::imports`.

## Start here

- `src/domain/service.rs`: `plan` decides start/stop; `start` handles scope fallback.
- `src/outbound/pg_repo.rs`: reservation, leases, and encrypted signing secrets.

## Scope

- Owns: webhook lifecycle, delivery verification and deduplication, Granola note mapping.
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
- Sync is off for users on Macro Connect: Connect holds Granola as MCP only, so
  their connection gives no API access and they are not holders.
- The connectors services name no account, so a reconnect to a different
  Granola account is not seen as a new account; `account_id` on
  `granola_sync_connections` only keeps older rows' values.

## Related

- Docs: `docs/agent-guide/calls.md` (Imported Granola meetings)
