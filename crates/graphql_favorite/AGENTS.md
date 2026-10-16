# graphql_favorite

## What it is

Backs the Favorites feature (Soup sidebar pinning): the GraphQL inbound
adapter exposing ordered favorite objects, user-scoped queries/mutations, and
the DataLoader-backed current-viewer favorite edge.

## Start here

- `src/objects.rs`: `GraphqlFavorite`.
- `src/queries.rs`: `resolve_favorites`, `FavoritesFilterInput`.
- `src/mutations.rs`: `FavoriteMutationRoot`, `ReorderFavoritesInput`.
- `src/loaders.rs`: `EntityFavoriteLoader` — the per-entity "is this
  favorited/what position" edge used from other GraphQL object types.

## Scope

- Owns: GraphQL types/resolvers for favorites and the favorite edge other
  object types embed.
- Not here: favorite storage and ordering logic → `crates/favorites`.

## Boundaries

- Depends on: `favorites` (ports only), `entity_mutation`,
  `graphql_entity_mutation`, `graphql_soup`, `graphql_common`.
- Used by: `complete_graph` (schema composition).

## Recipes

- Add a favorite field: `src/objects.rs` → `src/loaders.rs` if it needs a new
  batched fetch.
- Add a mutation: `src/mutations.rs` → the `favorites` domain port it calls.

## Checks

- `cargo test -p graphql_favorite` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
