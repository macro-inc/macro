# database_syncs

## What it is

Synced tables for Databases: a table kept in sync with an outside source
(the creator's imported Granola meetings, or a Notion data source read through
their Pipedream Notion connection). Rows are upserted by the source's id for
them, through the databases service, acting as the sync's creator.

## How it works

`POST /databases/{id}/syncs` (or `POST /databases/syncs` for a new database)
creates the table and its columns in one op batch under ids derived from the
client-minted sync id, then stores the sync, due at once. The harness worker
(`inbound::worker::run_worker`) leases a due sync, re-checks the creator's edit
access, reads the source, reconciles columns (`domain/columns.rs`), plans rows
(`domain/plan.rs`), then writes 500-row batches, recording each batch in
`database_sync_rows`. Granola imports mark the owner's Granola syncs due
(`inbound::call_imports::SyncOnCallImport`); otherwise Granola runs every 15
minutes and Notion every 30.

## Start here

- `src/domain/service.rs` + `src/domain/service/run.rs`: create flows and a run.
- `src/domain/plan.rs`, `src/domain/columns.rs`: the pure row and column plans.
- `src/outbound/pg_syncs_repo.rs`: leases (`due_at = 'infinity'` while leased).

## Scope

- Owns: `database_syncs`, `database_sync_rows`, the `/databases/syncs` routes
  (served by `agent_harness_service` cognition, not the document storage
  service), the worker.
- Not here: Notion reading and its column/cell mapping → `crates/import_notion`;
  Granola ingestion → `crates/granola_sync`; table writes → `crates/databases`.

## Boundaries

- Depends on: `databases` (`DatabasesService`, `DatabaseRowReads`,
  `CreatorAccess`), `import_notion` (`NotionConnections`, `macro_cells`),
  `call` (`CallImportService`), `granola_sync` (`Accounts`), `teams`.
- Used by: `services/agent_harness_service` (`cognition/server.rs` wiring and
  worker, `cognition/api.rs` routes).

## Checks

- `cargo test -p database_syncs --all-features` (`SQLX_OFFLINE` unset; needs a
  migrated local MacroDB)

## Gotchas

- Rows mirror the source: a row deleted in Macro comes back next run. Only a
  complete source read deletes rows (`DrainedRows.complete`).
- A column someone deletes or retypes, or whose Notion property changes type,
  is detached for good: its cells stay and the field is never added back.
- Ids are derived (UUIDv5) from the sync id, so a retried create or a run cut
  short finds the table, columns and options it made; insert row ids are
  reserved before the insert and reused on the next run.
- A run is cut off at two thirds of its lease, so no second worker takes the
  sync while it still writes. Never extend a run past `LEASE`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
  (span `database_sync.run`) · Skill: `database-core` · Docs:
  `docs/agent-guide/databases.md` (Synced tables)
