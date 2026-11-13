# dashboards

## What it is

Agent dashboards: a dashboard is a saved `dynamic_ui::View` with an owner,
`entity_access` grants and a version per save. An account points its home
dashboard at one; the web shows an agent account's home on its page.

## Start here

- `src/domain/service.rs`: the rules: flag gate, who may read and write,
  what a valid view is (`decode_view`, 64 KiB, unique pane ids), and how a
  save becomes a version.
- `src/outbound/pg_dashboard_repo.rs`: `dashboard_entities`,
  `dashboard_versions`, `dashboard_homes`.
- `src/inbound/axum_router.rs`: `/dashboards` routes, mounted by
  `document_storage_service`.

## Scope

- Owns: dashboards, their versions and home pointers.
- Not here: the view model and pane addressing → `crates/dynamic_ui`
  (`View::replace_pane`); access resolution → `crates/entity_access`
  (`queries/dashboard_access.rs`); direct grants and access requests →
  `crates/access_requests` (`ShareEntityType::Dashboard`); rendering →
  `apps/web/src/features/agent-dashboards`.

## Boundaries

- Depends on: `dynamic_ui`, `entity_access` (port), `entity_access_db_utils`
  (owner grant), `feature_flags`.
- Used by: `services/document_storage_service`; the SDK's `macro.dashboards`
  and `macro.me.setHomeDashboard`, which code mode exposes to agents.

## Checks

- `cargo test -p dashboards --all-features` (`SQLX_OFFLINE` unset).
- `cargo test -p entity_access --all-features dashboard_access`.

## Gotchas

- Access: the owner owns; owners and admins of any team the owner belongs to
  edit; anything else comes from `entity_access` grants. People never edit a
  dashboard in the app in v1, only through the API.
- Every route answers 404 unless `enable-agent-dashboards` is on for the
  caller, and a caller without access gets 404, never 403.
- A save is a compare-and-set on `current_version`; a lost race is 409. A
  pane patch without `expectedVersion` rereads and retries.
- Old versions are stored undecoded on read and decoded again on revert,
  because the view schema moves on.
- Not a Soup kind: dashboards are not in Home, Recent, search or Drive, and
  have no trash; delete is permanent and owner-only.
- A new widget variant needs arms in `dynamic_ui`'s `pane.rs` walkers.
