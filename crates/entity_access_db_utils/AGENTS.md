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
- `src/project_grants.rs`: the grants an entity inherits from the folders it
  is filed in, written when it enters or leaves one; databases and forms call
  it in the same transaction as their `project_id` write.
  `refuse_filing`/`refuse_filing_in` check, in the transaction that writes
  the folder id, the grants a later inheritance step would write;
  `refuse_unregistered_filing` checks a move of a document without a UUID,
  which reads its folder chain's grants and owners instead of holding rows.
- `src/scoped_grants.rs`: refuses, under an agent session scope that may not
  share, a grant that adds access (a grantee without an equal or stronger row
  on the entity); the helpers that revoke a direct user, team or channel grant
  refuse to remove one.

## Scope

- Owns: writes to the `entity_access` table.
- Not here: read-side access-level checks → `crates/entity_access`; the
  owner-grant policy that decides *which* grants to write on creation →
  `crates/entity_access_management`.

## Boundaries

- Depends on: `agent_correlation`, `macro_user_id`, `model-entity`,
  `model_owner`, `models_entity_access_management`, `models_permissions`.
- Used by: `crates/entity_access_management`, `crates/entity_registry/entity_registry_db_utils`,
  and most domain crates that grant access as part of a write
  (`channels`, `projects`, `teams`, `crm`, `call`, `chat`, `documents`,
  `databases`, `email`, `forms`, `macro_db_client`, `crates/scheduled_action`).

## Recipes

- Add a grant helper: `src/source_grants.rs` (or a new `src/<source>.rs`) →
  export from `src/lib.rs` → a fixture under `fixtures/*.sql` if the test
  needs seed rows.

## Checks

- `cargo test -p entity_access_db_utils` (`SQLX_OFFLINE` unset; requires
  local MacroDB — `just setup_macrodb`).

## Gotchas

- Helpers never commit; each takes the caller's `&mut Transaction<'_, Postgres>`
  (or `&mut PgConnection` when it needs no guard) and the caller commits once
  alongside its own row writes.
- Every helper that writes or revokes a grant calls `scoped_grants`; a refusal
  is `sqlx::Error::InvalidArgument(SharingRefused::MESSAGE)` and the caller's
  transaction writes nothing. A new grant writer or revoker calls it too.
  Deleting an entity's rows, membership cleanup (`source_grants`) and the
  inherited rows a folder move removes are not checked, nor is a new row's
  owner grant unless the owner is a team. `project_grants::inherit_project_grants`
  is not checked either: a move drops the old folder's rows before it
  inherits, so the write that files an entity calls
  `project_grants::refuse_filing` first, against the rows it holds then.
- Folder direct-grant changes hold `team_share::acquire_guard` before entity/row
  locks, matching project topology propagation. Legacy non-UUID children inherit
  through their parent dynamically and do not get UUID grant rows.

- `external_chat` entities use the generic direct-sharing facts and grant helpers; provider membership never creates a grant.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md`
