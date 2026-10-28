# entity_access_db_utils

## What it is

Shared infrastructure backing entity access across every feature:
transactional helpers for the shared `entity_access` table — insert grant
rows, and the channel-share/team-share/source-grant query helpers built on
top of it.

## Start here

- `src/lib.rs`: `insert_entity_access_row`, `OwnerGrantSource` — the base
  insert other helpers build on.
- `src/source_grants.rs`: `delete_source_grants` and friends, grouped by
  `EntityAccessSourceType`.
- `src/channel_share.rs`, `src/team_share.rs`: grant helpers scoped to a
  channel or team source.
- `src/direct_share.rs`: live ownership facts and direct user grants for access requests.

## Scope

- Owns: writes to the `entity_access` table.
- Not here: read-side access-level checks → `crates/entity_access`; the
  owner-grant policy that decides *which* grants to write on creation →
  `crates/entity_access_management`.

## Boundaries

- Depends on: `macro_user_id`, `model-entity`, `model_owner`,
  `models_entity_access_management`, `models_permissions`.
- Used by: `crates/entity_access_management`, `crates/entity_registry/entity_registry_db_utils`,
  and most domain crates that grant access as part of a write
  (`channels`, `projects`, `teams`, `crm`, `call`, `chat`, `documents`,
  `macro_db_client`, `crates/scheduled_action`).

## Recipes

- Add a grant helper: `src/source_grants.rs` (or a new `src/<source>.rs`) →
  export from `src/lib.rs` → a fixture under `fixtures/*.sql` if the test
  needs seed rows.

## Checks

- `cargo test -p entity_access_db_utils` (`SQLX_OFFLINE` unset; requires
  local MacroDB — `just setup_macrodb`).

## Gotchas

- Helpers never commit; every function takes `&mut Transaction<'_, Postgres>`
  and the caller commits once alongside its own row writes.
- Folder direct-grant changes hold `team_share::acquire_guard` before entity/row
  locks, matching project topology propagation. Legacy non-UUID children inherit
  through their parent dynamically and do not get UUID grant rows.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md`
