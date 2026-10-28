# models_properties

## What it is

Part of the custom-properties feature (custom fields on documents, CRM
records, and other entities). Data models for the custom-properties system,
split into three layers plus a `shared` layer used by all of them.

## Start here

- `src/shared/`: `EntityType`, `DataType`, `EntityReference`, `PropertyOwner`
  — used by every layer below.
- `src/db/`: database-row types (`entity_property.rs`,
  `property_definition.rs`, `property_option.rs`) — used only by the
  `properties` crate's outbound adapters.
- `src/service/`: business-logic types used within `properties_service`
  (property values, tag sets, per-entity-kind metadata like
  `document_metadata.rs`, `thread_metadata.rs`).
- `src/api/`: external-facing request/response types (`requests.rs`,
  `responses.rs`, `property_target.rs`, `query_params.rs`).

## Scope

- Owns: the property system's models across its three layers, converted
  db → service → api.
- Not here: property authorization or storage logic → `properties`,
  `properties_service`.

## Boundaries

- Depends on: `document_sub_type`.
- Used by: `agent_trigger`, `ai_tools`, `complete_graph`, `crm`, `databases`,
  `databases_sql`, `documents`, `document_storage_service`, `email_service`,
  `forms`, `graphql_common`, `graphql_crm`, `graphql_initiative`,
  `graphql_properties`, `graphql_soup`, `import`, `initiative`, `messages`,
  `models_soup`, `properties`, `properties_service`, `scheduled_action`,
  `search_service`, `soup`, `soup_realtime`, `system_properties`.

## Recipes

- Add a property-backed field for a new entity kind: `src/shared/entity_type.rs`
  → `src/db/entity_property.rs` → `src/service/<kind>_metadata.rs` →
  `src/api/responses.rs`.

## Checks

- `cargo test -p models_properties` (`SQLX_OFFLINE` unset).

## Gotchas

- Respect the layering: `api` types convert from `service` types, which
  convert from `db` types — don't reach from `api` straight into `db`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
