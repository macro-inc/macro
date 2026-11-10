# graphql_ideas

> **Parked.** GraphQL for Ideas and routine suggestions is deferred; Ideas
> ships on REST. This branch is kept for later and is unfinished:
>
> - **Not served.** Nothing in `document_storage_service` puts
>   `IdeasGraphqlContext` or `RoutineSuggestionsGraphqlContext` into request
>   data, so every field here fails at runtime. The wiring waits on a choice
>   between two designs: (A) the storage service calls the scheduler's
>   existing routes as the user through one internal client, or (B) the
>   scheduler's adapters move into shared crates and the storage service
>   builds the domain services itself.
> - **Shapes behind the domain.** `ideaFeed.done` (ideas finished in the last
>   24 hours with what their run produced), `sends` on prompt ideas, and
>   `recordIdeasSeen` calling `GenerationService::seen` are not exposed yet.
>   Run composer/background, run status and opening targets have no
>   mutations.
> - **Live updates are interim.** No subscription or cache push; the web app
>   re-reads the routine suggestions list every 2 s while generating.
> - **Tests.** `src/mutation/test.rs`, `src/user_query/test.rs` and
>   `graphql_scheduled_action/src/suggestions/test.rs` are empty; resolver
>   tests so far use fakes in `complete_graph`.
> - **Web.** The web app's routine suggestion queries on this branch already
>   read GraphQL, so they do not work until the fields are served. Two files
>   left dead by that switch still need deleting:
>   `apps/web/src/features/routine-suggestions/queries/keys.ts` and
>   `apps/web/src/features/onboarding/queries/keys.ts`.

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
