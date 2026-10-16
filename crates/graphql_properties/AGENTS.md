# graphql_properties

## What it is

Shared infrastructure for features that attach custom properties to entities
(CRM, Initiatives): the GraphQL inbound adapter exposing property object
types, definitions, filter inputs, and the DataLoader-backed entity property
edge.

## Start here

- `src/objects.rs`: `GraphqlProperty`, per-data-type value types
  (`GraphqlStringPropertyValue`, `GraphqlNumberPropertyValue`, ...), and
  `load_entity_properties` — the edge embedded by other object types.
- `src/definitions.rs`: `GraphqlPropertyDefinition`, option values — the schema
  side (what properties exist), as opposed to `objects.rs` (values set on an
  entity).
- `src/mutations.rs`: `PropertiesMutationRoot` — setting/clearing a property
  value on an entity.
- `src/loaders.rs`: `EntityPropertiesLoader` batching.

## Scope

- Owns: GraphQL types/resolvers for property definitions and values.
- Not here: property storage, selectable-option management, and filter
  evaluation → `crates/properties`, `crates/models_properties`.

## Boundaries

- Depends on: `properties` (ports only), `models_properties`, `entity_access`,
  `graphql_common` (re-exports its filter-expr types).
- Used by: `complete_graph`, `graphql_initiative`, `graphql_crm`.

## Recipes

- Add a property data type's GraphQL value: `src/objects.rs` (value type) →
  `src/definitions.rs` (option/definition shape if selectable) →
  `src/mutations.rs` (`GraphqlSetPropertyValue` variant).
- Add a field to property definitions: `src/definitions.rs` →
  `load_property_definitions`.

## Checks

- `cargo test -p graphql_properties` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
