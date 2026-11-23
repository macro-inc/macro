# graphql_registered_work

## What it is

Part of agent sessions: the GraphQL inbound adapter for registered work, the
sessions an account registered as its work. Exposes `registeredWork` under the
viewer and the `registeredWorkUpdates` subscription. Not Home's work feed
(`graphql_work_feed`), which is a different feature.

## Start here

- `src/query.rs`: `resolve_registered_work` and `load_entry`, hydrating a
  registration with its Soup agent session.
- `src/subscriptions.rs`: `RegisteredWorkSubscriptionRoot`, batching the
  viewer's session Soup patches with `attention_feed`'s `live::coalesce`.
- `src/objects.rs`: `GraphqlRegisteredWork` and the patch union.
- `src/context.rs`: `RegisteredWorkGraphqlContext`, built by the composition
  root.

## Scope

- Owns: GraphQL types, resolvers, and the subscription for registered work.
- Not here: registering, ending, and viewer filtering →
  `agent_session::domain::work_registration`; HTTP routes →
  `agent_session::inbound::axum_router::work_registration`; publishing session
  changes → `soup_realtime::outbound::agent_sessions`.

## Boundaries

- Depends on: `agent_session` (domain only), `attention_feed` (coalescing),
  `graphql_soup`, `graphql_common`, `soup_realtime` (ports only).
- Used by: `complete_graph` (schema composition).

## Recipes

- Add a field: `src/objects.rs`, then regenerate `static_assets/schema.graphql`
  (see `crates/complete_graph/AGENTS.md`).

## Checks

- `cargo nextest run --all-features -p complete_graph registered_work`
  (`SQLX_OFFLINE` unset); the schema tests live with the composition.

## Gotchas

- A viewer who loses access hears nothing, because session changes go to current
  accessors. The stream invalidates every `REFRESH_INTERVAL` to bound how long a
  revoked entry stays shown, and it covers channel and team membership changes
  no event reports.
- Never name a registration the viewer cannot view, even to remove it: such a
  session yields `Invalidate`, and the client's refetch drops it.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
