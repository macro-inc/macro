# properties_inbound

## What it is

Part of the Databases and CRM features: the Properties HTTP API (feature
`axum`: routes, router state, OpenAPI paths) and the AI property/tag toolset
(feature `ai_tools`), both driving the `properties` domain service. It is its
own crate so a route or tool edit rebuilds only this crate and the roots that
serve it, not the ~100 crates that depend on `properties`.

## Start here

- `src/axum_router.rs`: router, state and error-to-status mapping;
  `axum_router/` holds one file per resource (definitions, options, tags,
  entities, managed).
- `src/toolset.rs`: `PropertiesToolContext` and `properties_toolset()`.

## Boundaries

- Depends on: `properties` (domain), `entity_access`, `macro_authorization`
  (axum), `ai_toolset` (ai_tools).
- Used by: `properties_service`, `services/document_storage_service`,
  `ai_tools`.

## Checks

- `cargo test -p properties_inbound` (uses `properties`' `mock` feature).

## Tool contracts

- AI property/tag adapters omit legacy chat targets; this does not change
  persisted property entity types.
