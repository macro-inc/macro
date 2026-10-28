# saved_views

## Scope

This crate owns saved-view definitions, revisions, effective team sharing, and legacy personal REST storage. Consumers own their versioned JSON configuration; saved views do not execute entity queries.

## Start here

- `src/domain.rs`: authorization, current-membership validation, optimistic writes, bounded visible pagination, and storage/membership ports. Fetch batches with `list_views_for_access_check`, then validate the viewer and owner against one primary-backed member list per distinct team in each batch; recheck previously collected views on later batches.
- `src/pgsql.rs`: primary-backed SQLx queries, owner/revision guards, and per-ID transaction locks. Physical deletes leave permanent ID-only tombstones; never purge them or bypass the create lock. Deletion triggers must not acquire that lock after locking a row; creation rechecks tombstones after INSERT to catch legacy deletes.
- `src/storage.rs`: legacy REST PATCH payload and excluded-default storage.

## Checks

Run `cargo test -p saved_views` with a local migrated MacroDB and `SQLX_OFFLINE` unset. Run `nix develop --command just prepare_db` after changing SQL or migrations. Never query `team_user` from this crate; the Teams-owned evidence adapter belongs at composition. For migration checks, use a fresh disposable local database. Run each concurrent-index migration separately with `PGOPTIONS="-c lock_timeout=2s"`. Owner departure disables sharing; owner rejoining restores it.
