# models_pagination

## What it is

Shared infrastructure. Typesafe, generic cursor pagination and simple sort
methods, shared by almost every list endpoint in the backend.

## Start here

- `src/cursor.rs`: `Identify`, `Sortable`, `SortOn`, `Paginate`/`Paginated` —
  the three traits an item/sort method must implement to be paginated, plus
  the opaque base64 cursor types.
- `src/sort.rs`: concrete sort methods (`CreatedAt`, `Frecency`, `NotifiedAt`,
  `TouchedByMe`, `SimpleSortMethod`).
- `src/collections.rs`: `CollectBy`/`CollectByIds` helpers.
- `src/axum.rs` (feature `axum`): `BidirectionalCursor` extractor.

## Scope

- Owns: the cursor encoding, sort trait contracts, and axum query extraction
  for paginated list endpoints.
- Not here: the actual query/sort implementation for a given entity — that
  lives in the owning domain crate (e.g. `soup`, `messages`).

## Boundaries

- Depends on: nothing domain-specific — pure pagination machinery
  (`base64`, `ordered-float`, optional `axum`/`model-error-response`).
- Used by: most list-returning crates — `ai_tools`, `calendar_events`, `call`,
  `channels`, `complete_graph`, `databases_sql`, `email`, `email_db_client`,
  `foreign_entity`, `github_pull_requests`, `graphql_activity`,
  `graphql_calendar`, `graphql_initiative`, `graphql_soup`, `macro_db_client`,
  `messages`, `model`, `model_notifications`, `models_email`, `models_soup`,
  `notification`, `notification_db_client`, `skills`, `soup`, `teams`.

## Recipes

- Add a new sort method: `src/sort.rs` (impl `Sortable`/`SortOn`) → the
  caller's `Identify` impl for its item type → its list query.

## Checks

- `cargo test -p models_pagination` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
