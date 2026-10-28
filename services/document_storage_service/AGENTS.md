# document_storage_service

## What it is

Documents feature: deployable service (DSS) hosting document/item CRUD, the
"Soup" GraphQL API, and most cross-entity concerns — history, annotations,
threads, pins, recents, notifications, folders, activity.

## Start here

- `src/api.rs`: route module list — `documents`, `items`, `entity`,
  `folders_query`, `graphql_soup`, `threads`, `annotations`, `history`,
  `pins`, `recents`, `notification`, `instructions`, `internal`.
- `/databases/query` mounts the `databases_sql` HTTP adapter, sharing the database/access services and the primary Soup reader; SQL authorization stays in its domain service.
- `src/api/graphql_soup.rs`: the `/soup/graphql` (+ `/soup/graphql/ws`
  subscriptions) GraphQL API — the frontend's main read path for Home/Recent/
  search ("Soup" items); see `crates/graphql_soup` for resolvers/loaders.
- `src/server.rs`: composition root, including access-request routes and the
  tracked delivery dispatcher; `src/outbound/access_requests.rs` composes the
  notification/withdrawal/realtime ports. Policy lives in `crates/access_requests`.
- Guest call chat is mounted outside account auth at `/call/guest-chat/{call_id}`;
  `call` verifies the RTC session and `messages` owns the shared discussion.
- `src/service/entity_mutation.rs`: generic entity-mutation plumbing used
  across item types.
- `src/outbound/docx_export.rs`: primary-database parts and immutable DOCX export
  objects keyed by part paths/hashes. The export route maps the documents domain's
  pending result to 409 with `Retry-After`; never reuse document-id-only archives.
  Location and export URLs share signing helpers in `src/service/cloudfront.rs`.
- `src/service/delete_document_worker.rs`: background worker handling document
  deletion side effects (feature-gated: `delete_document_worker`).
- `src/service/conn_gateway.rs`: pushes realtime updates through
  `connection_gateway` (feature-gated: `connection_gateway`).
- `README.md`: local setup (`just run_dbs`, `.env` from `.env.sample`).

## Scope

- Owns: document/item HTTP CRUD, the Soup GraphQL schema, and cross-entity
  surfaces (history, annotations, threads, pins, recents, notifications,
  folders, saved views, activity).
- Not here: document content/collaboration itself → `crates/collab_surface`
  and the sync service; AI chat → `document_cognition_service`.

## Recipes

- Add a Soup GraphQL field: resolver/loader in `crates/graphql_soup` →
  `src/api/graphql_soup.rs` if wiring changes.
- Add a REST route: `src/api/<area>.rs` → `src/api.rs` (router) →
  `src/openapi.rs`.
- Add a config value or feature-gated behavior: `src/config.rs` → the
  `[features]` table in `Cargo.toml` if it should be independently toggleable.

## Checks

- `cargo test -p document_storage_service` (`SQLX_OFFLINE` unset; needs
  MacroDB + Redis — `just run_dbs` from repo root; DynamoDB local via
  `just ensure::ensure_dynamodb`, see `justfile`).
- After query changes: `nix develop --command just prepare_db` from the repo root.

## Gotchas

- Several behaviors are Cargo-feature-gated (`connection_gateway`,
  `delete_document_worker`, `location_check`, all on by `default`) — a feature
  disabled locally can hide a bug that only shows in deployed builds.
- Soup GraphQL reads a replica with multi-second lag; a read immediately after
  a write through the same request needs the primary-reading loader, not the
  default one — see `crates/graphql_soup`.
- Dev's readonly pool keeps 2–20 connections per task, independently of the
  primary pool's 25–100. Once all tasks use this cap, three dev tasks allow 60
  sessions, or 120 while a rolling deployment overlaps all three. Old tasks
  retain their previous cap until they drain during the initial rollout.
  Production and local pools retain their existing primary/readonly limits.
- The GraphQL calendar feed (occurrence ranges and `calendarChanges`) reads the
  primary, like the REST calendar routes: a `refresh_calendar` poke goes out as
  a write commits, so a replica-backed delta misses the change it announces.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/observability.md`
