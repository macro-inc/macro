# graphql_initiative

## What it is

Backs the Initiatives feature (named task groupings): the typed GraphQL
inbound adapter exposing initiative queries, mutations, and loaders.

## Start here

- `src/context.rs`: `InitiativeGraphqlContext` and `InitiativeAuthorizer` —
  how resolvers reach the `initiative` domain service.
- `src/query.rs` / `src/mutation.rs`: `resolve_initiative`,
  `InitiativeMutationRoot`.
- `src/loaders.rs`: `InitiativeLoader` — one batched initiative read per
  request for Soup and detail views. Detail and progress fields share its
  task-access walk; progress is summarized lazily from that read.
- `src/lib.rs` `graphql_error`: maps `InitiativeError` to GraphQL error codes
  (`NOT_FOUND`, `FORBIDDEN`, `BAD_USER_INPUT`, `CONFLICT`) — follow this
  pattern rather than returning a bare `async_graphql::Error`.

## Scope

- Owns: GraphQL types, queries, mutations, and loaders for initiatives.
- Not here: initiative lifecycle, assignment, and storage → `crates/initiative`;
  initiative properties → `crates/graphql_properties`.

## Boundaries

- Depends on: `initiative` (ports only), `graphql_properties`, `graphql_soup`,
  `graphql_permission`, `models_permissions`.
- Used by: `complete_graph` (schema composition).

## Recipes

- Add a query field: `src/query.rs` → `src/loaders.rs` if it needs a new
  batched fetch → `src/objects.rs`.
- Add a mutation: `src/mutation.rs` → the `initiative::domain` port it calls →
  `graphql_error` if it introduces a new `InitiativeError` variant.

## Checks

- `cargo test -p graphql_initiative` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
