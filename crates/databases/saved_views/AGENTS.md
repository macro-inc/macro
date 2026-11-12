# saved_views

## Scope

This crate owns saved-view definitions, revisions, effective team sharing, and legacy personal REST storage. Consumers own their versioned JSON configuration; saved views do not execute entity queries. `SavedViewApi` is the one contract both transports use: GraphQL for the app, and document storage's `/saved_views/definitions` REST routes for the SDK.

## Start here

- `src/domain.rs`: authorization, current-membership validation, optimistic writes, bounded visible pagination, and storage/membership/change-notifier ports. Create, update, delete and reorder call `ChangeNotifier` once after they commit, naming the kind (`None` when it changed or is missing), the acting user and the teams shared with before or after; retries and failed writes stay silent, and legacy methods never signal. Fetch batches with `list_views_for_access_check`, then validate the viewer and owner against one primary-backed member list per distinct team in each batch; recheck previously collected views on later batches.
- `src/pgsql.rs`: primary-backed SQLx queries, owner/revision guards, and per-ID transaction locks. Physical deletes leave permanent ID-only tombstones; never purge them or bypass the create lock. Deletion triggers must not acquire that lock after locking a row; creation rechecks tombstones after INSERT to catch legacy deletes.
- `src/storage.rs`: legacy REST PATCH payload and excluded-default storage.
- Order is personal: `saved_view_position` holds each viewer's position per visible view, outside the definition and its revision. Lists sort placed views first, then by creation time and ID, and the cursor carries all three. `reorder` replaces one kind's order whole (views left out become unplaced) under a per-viewer, per-kind advisory lock.

## Checks

Run `cargo test -p saved_views` with a local migrated MacroDB and `SQLX_OFFLINE` unset. Run `nix develop --command just prepare_db` after changing SQL or migrations. Never query `team_user` from this crate; the Teams-owned evidence adapter belongs at composition. For migration checks, use a fresh disposable local database. Run each concurrent-index migration separately with `PGOPTIONS="-c lock_timeout=2s"`. Owner departure disables sharing; owner rejoining restores it.
