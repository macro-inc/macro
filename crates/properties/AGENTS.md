# properties

## What it is

Part of the Databases and CRM features. Entity properties: definitions,
selectable options (including tags), per-entity values, and the CRM
pipeline/stage definitions built on them. Publishes property mutation
events to the `macro.properties` Kafka topic.

## Start here

- `README.md`: the published event catalog (`property.created`,
  `entity_property.updated`, ...) — read before changing anything that writes
  a property or option.
- `src/domain/service_impl.rs` + `src/domain/ports.rs`: the service and the
  writer/notification/permission ports it composes.
- `src/domain/model.rs`: `EntityPropertiesKey`, `PropertyTargetKey`, and the
  CRM team-stage definition constant.
- `src/outbound/properties_pg_repo.rs` +
  `src/outbound/*_queries.rs`: the Postgres adapters, one file per concern
  (definitions, options, entity values, metadata, tag promotion).

## Scope

- Owns: property definitions/options/values and tag promotion across entity
  types.
- Not here: the generic database engine (tables/columns/cells) → `databases`;
  notification delivery → `notification`.

## Boundaries

- Depends on: `entity_access`, `macro_event_broker`, `model_owner`,
  `notification` (optional, `outbound` feature).
- Used by: `databases`, `ai_tools`, `agent_trigger`, `initiative`, `messages`,
  `search_service`, `soup`, `crm`, `graphql_properties`, `properties_service`,
  `services/document_storage_service`, `services/agent_trigger_service`,
  `services/search_processing_service`.

## Recipes

- Add a property event: `src/domain/events.rs` → emit it in
  `src/domain/service_impl.rs` after the write succeeds → document it in
  `README.md`'s event table.
- Add a query: `src/outbound/<concern>_queries.rs` → its sibling `_test.rs`.

## Checks

- `cargo test -p properties` (`SQLX_OFFLINE` unset; requires local MacroDB).
- `cargo test -p properties --no-default-features --features outbound` to
  check the outbound-only build other services depend on.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `README.md`
