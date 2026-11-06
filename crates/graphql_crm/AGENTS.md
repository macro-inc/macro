# graphql_crm

## What it is

Backs the CRM feature: the typed GraphQL inbound adapter for CRM pipeline
records (rows that reference a company or contact), composed onto their Soup
entities.

## Start here

- `src/objects.rs`: `GraphqlCrmPipeline`/`GraphqlCrmPipelineEntry` and related
  typed objects.
- `src/loaders.rs`: `PipelineEntriesLoader` — batches pipeline entries by
  record (company/contact) across a query.
- `src/context.rs`: `CrmGraphqlContext` and the object-safe `CrmPipelineApi`
  forwarding trait over `crm::domain::pipelines::PipelineService`.

## Scope

- Owns: the GraphQL shape over CRM pipeline entries.
- Not here: pipeline domain logic and storage → `crates/crm` (built on
  `crates/databases`).

## Boundaries

- Depends on: `crm` (ports), `databases` (ports), `entity_access` (ports),
  `graphql_common`, `graphql_properties`.
- Used by: `complete_graph`, `document_storage_service`.

## Recipes

- Add a pipeline field: `crm::domain::pipelines` (domain) → `src/objects.rs`
  → `src/loaders.rs` if it needs batched loading → `src/context.rs`.

## Checks

- `cargo test -p graphql_crm`.

## Related

- Skill: `database-core` · Rules: `.agents/rules/rust/architecture.md`
