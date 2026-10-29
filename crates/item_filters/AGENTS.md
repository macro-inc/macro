# item_filters

## What it is

Belongs to Search (Soup): typed filter DTOs for every entity type searchable
in soup/search, plus the AST layer that expands them into a strict,
logically-combinable query form.

## Start here

- `src/lib.rs`: the public filter structs (`DocumentFilters`, `EmailFilters`,
  `ChannelFilters`, `CallFilters`, `EntityFilters`, ...) — one per entity type,
  bundled together in `EntityFilters`.
- `src/ast.rs` + `src/ast/<entity>.rs`: typed AST literals each filter struct
  expands into, via `ExpandFrame`/`Expr` from `filter_ast`, for consumers that
  need a logical (AND/OR/NOT) representation instead of a flat DTO.
- `src/ast/tests.rs`: expansion test coverage per entity type.

## Scope

- Owns: the filter DTO shape for every soup entity type, their `IsEmpty`
  semantics (an empty filter must impose no constraint), and the AST expansion
  used to turn a filter into a query.
- Not here: the `fef:` filter-query-language parser (`filter_ast`), applying
  filters to a search backend (OpenSearch/Postgres), or authorization checks
  on filter values (e.g. CRM domain/address ownership) — those live in the
  service that calls in (e.g. `email`, `crm`).

## Boundaries

- Depends on: `filter_ast`, `document_sub_type`, `notification_state`,
  `model_file_type`, `model_owner`, `macro_user_id`.
- Used by: crates building soup/search queries (`graphql_soup`,
  `database_sql`/`databases_sql`, `email`, `channels`, `crm`, `call`,
  `github_pull_requests`, `ai_tools`, `search_service`, `item_filter_index`);
  a new field here needs each `IsEmpty` impl updated or filters silently stop
  being "no-ops" when empty.

## Recipes

- Add a filter field to an existing entity (e.g. `EmailFilters`): add the
  field in `src/lib.rs` → update that struct's `IsEmpty` impl (the destructure
  forces you not to forget it) → add/extend the matching AST literal in
  `src/ast/<entity>.rs` → extend `src/ast/tests.rs`.
- Add a new filterable entity type: new struct + `IsEmpty` impl in
  `src/lib.rs` → new `src/ast/<entity>.rs` module declared in `src/ast.rs` →
  field on `EntityFilters` → the caller's expansion code.

## Checks

- `cargo test -p item_filters` (`SQLX_OFFLINE` unset).

## Gotchas

- CRM associations serialize company/contact IDs or the unit string `activity`.
  The CRM service resolves activity scope; clients do not enumerate record IDs.

- Several entity types (initiatives, agent sessions) are opt-in: `include:
  false` by default, and asking for specific ids/owners also implicitly opts
  in — don't assume an empty `include` flag means "show everything".
- `#![deny(missing_docs)]`: every new public field needs a doc comment.

## Related

- Rules: `.agents/rules/rust/code.md` (CS-54 missing-docs)
