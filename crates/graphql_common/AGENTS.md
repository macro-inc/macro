# graphql_common

## What it is

Shared infrastructure for every product feature's GraphQL adapter crate:
request-scoped extractor context, filter-input conversion, and cross-domain
schema types (entity type, owner type, property filters).

## Start here

- `src/request_context.rs` + `src/extract.rs`: `GraphqlRequestParts`, the
  per-request context every resolver pulls from, and its Axum extraction.
- `src/authorization.rs`: `require_authenticated_user` /
  `require_authorized_user` — the two checks resolvers call before touching data.
- `src/filter_input.rs`: `IntoFilterExpr`, `parse_id`/`parse_uuid`/`parse_macro_user_id`
  — shared GraphQL-input-to-domain-type conversions.
- `src/entity_type.rs`, `src/owner_type.rs`, `src/property_filter.rs`: schema
  types reused across domain crates so two adapters don't define incompatible
  GraphQL shapes for the same concept.

## Scope

- Owns: cross-domain GraphQL conventions — context, auth checks, filter/limit
  input parsing, shared entity/owner/property types.
- Not here: any one domain's resolvers or objects → `crates/graphql_<domain>`.

## Boundaries

- Depends on: `macro_authorization` (axum), `filter_ast`, `item_filters`,
  `model-entity`, `model_owner`, `models_properties`.
- Used by: every `graphql_*` domain adapter crate (favorite, initiative,
  calendar, email, notification, soup_filter_input, entity_mutation,
  properties, crm, soup, channel, work_feed, activity) and `complete_graph`
  (the schema that composes them all).

## Recipes

- Add a shared filter/input type: `src/property_filter.rs` or
  `src/filter_input.rs` → used from the domain crate's input types.
- Change the request context: `src/request_context.rs` → `src/extract.rs` →
  every domain crate that reads a new field from it.

## Checks

- `cargo test -p graphql_common`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
