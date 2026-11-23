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
- `src/task_dependencies.rs`: request-scoped task dependency facts; `setTaskProperty` returns the edited assignment and reciprocal normalized state. Search hydrates at most 500 task IDs per request; realtime uses independent related-task patches, and incomplete mutation effects trigger a scoped repair.
- Task mutations retain actual reciprocal IDs from the committed domain outcome; pre/post reads alone miss concurrently removed neighbors.
- Pass blocker view receipts to the properties domain's `visible_state` projection; preserve aggregate `isBlocked` and opaque membership while redacting individual inaccessible-blocker facts.
- Share at most 1000 blocker visibility checks and one five-second read deadline across the request's loader batches; unverified blockers retain canonical aggregate state but expose no individual facts. Never expose a hidden-open subgroup flag.
- Map wrapped `PropertiesErr::DependencyContended` to `DEPENDENCY_BUSY` with `retryable: true`; the web queue retries idempotent `SetTaskProperty` twice.
- Map `PropertiesErr::TaskCompletionBlocked` through wrapped report contexts to `TASK_BLOCKED` and the opaque task ID; never classify completion rejection by display text.

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
