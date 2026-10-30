# models_soup

## What it is

Part of the Soup feed (Home/Recent, the unified activity feed). Shared API
models: one module per entity kind Soup can surface, plus the unified item
model.

## Start here

- `src/item.rs`: the unified Soup feed item — the type every entity kind's
  module converts into.
- `src/document.rs`, `src/chat.rs`, `src/comms.rs` (channels), `src/crm_company.rs`,
  `src/crm_contact.rs`, `src/database_row.rs`, `src/email_thread.rs`,
  `src/initiative.rs`, `src/project.rs`, `src/call_record.rs`,
  `src/calendar_event.rs`, `src/agent_session.rs`, `src/foreign_entity.rs`:
  per-entity-kind Soup response models.
- `src/properties.rs`: `SoupProperty` — properties attached to a Soup item.

## Scope

- Owns: the Soup response model per entity kind and the unified item type.
- Not here: the GraphQL resolvers or feed query logic → `soup`, `graphql_soup`;
  the Soup filter DSL → `item_filters`, `soup_filter_projection`.

## Boundaries

- Depends on: `call`, `channels`, `crm`, `document_sub_type`, `doppleganger`,
  `email`, `macro_user_id`, `model`, `model-entity`, `model_owner`,
  `models_pagination`, `models_properties`.
- Used by: `ai_tools`, `complete_graph`, `databases_sql`, `graphql_initiative`,
  `graphql_soup`, `models_search`, `search_service`, `skills`, `soup`,
  `soup_filter_projection`, `work_feed`.

## Recipes

- Add a new entity kind to Soup: new `src/<kind>.rs` → wire it into
  `src/item.rs`'s unified item → `soup` (feed query) →
  `graphql_soup` (GraphQL exposure).

## Checks

- `cargo test -p models_soup` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
