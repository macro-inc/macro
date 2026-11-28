# graphql_crm

## What it is

Backs the CRM feature with typed record creation and pipeline entries
composed onto CRM Soup entities.

## Start here

- `src/objects.rs`: `GraphqlCrmPipeline`/`GraphqlCrmPipelineEntry` and related
  typed objects, including monetary-column currency links and system defaults.
- `src/loaders.rs`: `PipelineEntriesLoader` — batches pipeline entries by
  record (company/contact) across a query.
- `src/context.rs`: `CrmGraphqlContext` and the object-safe `CrmPipelineApi`
  forwarding trait over `crm::domain::pipelines::PipelineService`.
- `src/mutations.rs`: `createCrmCompany` and `createCrmContact` call the
  same authorized CRM domain methods as the REST routes. Both take a stable
  client request ID for replay and return primary-backed Soup effects.

## Scope

- Owns: the GraphQL shape over CRM creates and pipeline entries.
- Not here: pipeline domain logic and storage → `crates/crm` (built on
  `crates/databases`).

## Boundaries

- Depends on: `crm` (ports), `databases` (ports), `entity_access` (ports),
  `graphql_common`, `graphql_entity_mutation`, `graphql_properties`, and
  `graphql_soup`.
- Used by: `complete_graph`, `document_storage_service`.

## Recipes

- Add a pipeline field: `crm::domain::pipelines` (domain) → `src/objects.rs`
  → `src/loaders.rs` if it needs batched loading → `src/context.rs`.

## Checks

- `cargo test -p graphql_crm`.

## Related

- Skill: `database-core` · Rules: `.agents/rules/rust/architecture.md`
