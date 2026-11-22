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
- `src/tags.rs`: `GraphqlTagSet` and `load_tag_sets` — the viewer's personal
  and team tag sets (TAG-typed definitions whose options are labels); the team
  set is listed whenever the viewer is on a team, with a null definition until
  it is provisioned.
- `src/mutations.rs`: `PropertiesMutationRoot` — setting/clearing a property
  value on an entity.
- `src/catalog.rs`: `PropertyCatalogMutationRoot` — creating and deleting
  definitions, adding/updating/deleting their options, and provisioning,
  promoting and merging tags. Each mutation makes the same properties-service
  call as its REST route, with the same team receipt and managed-definition
  guard (`properties::ManagedTeamDefinitions`); refusals carry
  `extensions.code` (`BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`,
  `INTERNAL`), deletes answer `GraphqlCacheDeletion`, and a promotion name
  conflict is a `GraphqlTagPromotionConflict` result, not an error.
- `src/loaders.rs`: `EntityPropertiesLoader` batching.

## Scope

- Owns: GraphQL types/resolvers for property definitions, options, tag sets
  and values, and the GraphQL writes to each.
- Not here: property storage, the catalog rules themselves, and filter
  evaluation → `crates/properties`, `crates/models_properties`.

## Boundaries

- Depends on: `properties` (its service trait and domain models, never its
  adapters), `models_properties`, `entity_access`,
  `graphql_common` (re-exports its filter-expr types).
- Used by: `complete_graph`, `graphql_initiative`, `graphql_crm`.

## Recipes

- Add a property data type's GraphQL value: `src/objects.rs` (value type) →
  `src/definitions.rs` (option/definition shape if selectable) →
  `src/mutations.rs` (`GraphqlSetPropertyValue` variant).
- Add a field to property definitions: `src/definitions.rs` →
  `load_property_definitions`.
- Add a catalog write: a `PropertyCatalogWriter` method with a refusing
  default → its `PropertiesEntityPropertyWriter` impl calling the same service
  method as the REST handler (with its guard) → a field on
  `PropertyCatalogMutationRoot` → `src/catalog/test.rs`.

## Checks

- `cargo test -p graphql_properties` (`SQLX_OFFLINE` unset).
- `cargo test -p complete_graph` for the SDL contract after a schema change
  (needs a live database: `DATABASE_URL` set, `SQLX_OFFLINE` unset), then
  regenerate `static_assets/schema.graphql`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
