# graphql_bots

## What it is

Part of agent sessions and channels: the GraphQL inbound adapter for bots. It
defines `GraphqlBot`, the one normalized record (`GraphqlBot:<uuid>`) every
view reads a bot's name, handle and picture from, plus the viewer's bot
lookups and lists and the resolvers other domains' edges use.

## Start here

- `src/objects.rs`: `GraphqlBot`, mapped from `bots::domain::models::BotIdentity`.
- `src/user_query.rs`: `GraphqlBotsQuery` (`bots(ids)`, `mentionableBots(channelId)`),
  flattened onto `GraphqlUser`.
- `src/loader.rs`: the request-scoped identity `DataLoader` and `resolve_bot`, which
  `GraphqlSoupAgentSession.botProfile` (in `complete_graph`) reads through.
- `src/context.rs`: `BotsGraphqlContext`, the type-erased request data, over the
  narrow `BotReads` and `ChannelMemberAuthorizer` ports.
- `src/subscription.rs`: `BotsSubscriptionRoot` (`botUpdates`), over
  `BotUpdatesGraphqlContext` and the bots crate's `BotUpdateSubscriptions`.

## Scope

- Owns: the bot GraphQL types and read fields, and mapping bot and access errors to
  GraphQL error codes.
- Not here: bot reads and policy → `crates/bots`; composition and Soup edges →
  `crates/complete_graph`; reading changes off the bot topic → `crates/bots`
  (`bot_updates`).

## Boundaries

- Depends on: `bots` (`ports`), `entity_access` (`ports`), `graphql_common`.
- Used by: `complete_graph`, `document_storage_service` (builds the context and loader).

## Checks

- `cargo test -p graphql_bots`
- Schema changes: `cargo test -p complete_graph`, then regenerate the SDL
  (`docs/guides/add-graphql-field.md` §5).

## Gotchas

- Identity reads have no access check: any signed-in user may read the identity of a
  bot id they hold, as `GET /bots/profiles` allows. `mentionableBots(channelId)`
  checks channel membership.
- Don't add a per-row list field (such as a channel's bots) on Soup entities without a
  batched loader: Soup pages run up to 500 rows, and a per-row access check plus
  query costs seconds of database time per page.
- DSS builds the context over the read replica; a bot changed in the last few
  seconds can read stale.
- DSS must insert `BotsGraphqlContext`, `bot_identity_loader(...)` and
  `BotUpdatesGraphqlContext` in `insert_graphql_context_data`; a missing insert
  only fails at query time.
- `botUpdates` ends with an error when the subscriber falls behind (16 buffered
  updates); the client resubscribes and refetches the bots it shows. Updates are
  sent only to `bot_audience`, so a bot that becomes visible some new way must be
  added there.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-graphql-field.md`
