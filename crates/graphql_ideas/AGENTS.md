# graphql_ideas

## What it is

The GraphQL inbound adapter for Ideas: the authenticated user's feed
(`GraphqlUser.ideaFeed`) and what they do with an idea (`acceptIdea`,
`dismissIdea`, `recordIdeasSeen`). The web app reads and writes ideas only
through these; the agent SDK (`macro.ideas`) stays on the scheduler's REST
routes.

## Start here

- `src/user_query.rs`: `GraphqlIdeasQuery`, flattened into `GraphqlUser`.
- `src/mutation.rs`: `IdeasMutationRoot`.
- `src/objects.rs`: `GraphqlIdea` (a cache entity keyed by the idea's id) and
  its embedded kind, targets and run.
- `src/context.rs`: `IdeasGraphqlContext`, the type-erased service in
  request data.
- `src/lib.rs` `idea_error`: `extensions.code` `NOT_FOUND`, `FORBIDDEN`,
  `INTERNAL_SERVER_ERROR`.

## Scope

- Owns: GraphQL types, reads and mutations for ideas.
- Not here: what an idea is, its rules and runs → `crates/ideas`; routine
  suggestions → `crates/graphql_scheduled_action`.

## Boundaries

- Depends on: `ideas` (domain types and `IdeaApi`), `graphql_common`.
- Used by: `complete_graph` (schema composition).

## Gotchas

- `ideaFeed` is null, and `recordIdeasSeen` false, when ideas are off for the
  user (`enable-ideas`); never an error, which would null `user`.
- Every mutation answers with the `GraphqlIdea` and its `id`, so the
  normalized cache updates each view that shows it.

## Checks

- `cargo test -p graphql_ideas` (`SQLX_OFFLINE` unset).
- `cargo test -p complete_graph` after a shape change, then regenerate
  `static_assets/schema.graphql` (see the
  [field guide](../../docs/guides/add-graphql-field.md)).

## Related

- Guide: `docs/guides/add-graphql-field.md`
- Rules: `.agents/rules/rust/architecture.md`
