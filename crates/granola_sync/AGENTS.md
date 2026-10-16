# granola_sync

## What it is

Imports Granola meeting notes as private Macro calls. Sync follows the user's
Granola connection in Pipedream; there are no user controls or user routes.

## How it works

The DCS worker (`inbound::run_worker`) reconciles every 30 seconds: each enabled
Granola account gets one webhook at the widest scope the key accepts (`All`,
falling back to `Workspace`), and syncs whose account was removed or replaced
are stopped. Granola posts signed events to the public webhook route; they are
stored durably, then leased, fetched through the Pipedream proxy, and ingested
through `call::domain::imports`.

## Start here

- `src/domain/service.rs`: `plan` decides start/stop; `start` handles scope fallback.
- `src/outbound/pg_repo.rs`: reservation, leases, and encrypted signing secrets.

## Scope

- Owns: webhook lifecycle, delivery verification and deduplication, Granola note mapping.
- Not here: call storage and reads → `crates/call`; Pipedream accounts → `crates/pipedream_mcp`.

## Boundaries

- Depends on: `call` import port, `pipedream_mcp` `ApiProxy` / `ConnectionStore` / `AppConnections`.
- Used by: `services/document_cognition_service` (composition root, worker, webhook route).

## Checks

- `cargo test -p granola_sync` (DB tests; leave `SQLX_OFFLINE` unset)

## Gotchas

- Granola only accepts public HTTPS webhook URLs, built from DCS `MCP_PUBLIC_URL`;
  reconcile is a no-op otherwise. Local stacks need a tunnel on
  `/cognition/integrations/granola/webhooks`.
- Granola discards a delivery permanently on 401 or other 4xx; return 503 while
  setup is still in flight so it retries.
- `namespace` must survive reconnects: it is the import identity in
  `call_entity_sources`, so re-registering never duplicates calls.
- Never log provider response bodies; webhook registration returns the signing secret.

## Related

- Docs: `docs/agent-guide/calls.md` (Imported Granola meetings)
