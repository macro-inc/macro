# graphql_bots

## What it is

Part of agent sessions and channels: the GraphQL inbound adapter for bots. It
defines `GraphqlBot`, the one normalized record (`GraphqlBot:<uuid>`) every
view reads a bot's name, handle and picture from, plus the viewer's bot
lookups and lists and the resolvers other domains' edges use.

## Start here

- `src/objects.rs`: `GraphqlBot`, mapped from `bots::domain::models::BotIdentity`.
- `src/user_query.rs`: `GraphqlBotsQuery` (`bots(ids)`, `mentionableBots(channelId)`),
  flattened onto `GraphqlUser`, and `resolve_channel_bots` for `GraphqlSoupChannel.bots`.
- `src/loader.rs`: the request-scoped identity `DataLoader` and `resolve_bot`, which
  `GraphqlSoupAgentSession.botProfile` (in `complete_graph`) reads through.
- `src/context.rs`: `BotsGraphqlContext`, the type-erased request data, over the
  narrow `BotReads` and `ChannelMemberAuthorizer` ports.

## Scope

- Owns: the bot GraphQL types and read fields, and mapping bot and access errors to
  GraphQL error codes.
- Not here: bot reads and policy → `crates/bots`; composition and Soup edges →
  `crates/complete_graph`; live updates (planned `botUpdates` subscription).

## Boundaries

- Depends on: `bots` (`ports`), `entity_access` (`ports`), `graphql_common`.
- Used by: `complete_graph`, `document_storage_service` (builds the context and loader).

## Checks

- `cargo test -p graphql_bots`
- Schema changes: `cargo test -p complete_graph`, then regenerate the SDL
  (`docs/guides/add-graphql-field.md` §5).

## Gotchas

- Identity reads have no access check: any signed-in user may read the identity of a
  bot id they hold, as `GET /bots/profiles` allows. Channel lists check membership.
- `GraphqlSoupChannel.bots` is null, not an error, for a channel the viewer has not
  joined, so one such row in a Soup list does not fail the list.
- DSS must insert both `BotsGraphqlContext` and `bot_identity_loader(...)` in
  `insert_graphql_context_data`; a missing insert only fails at query time.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-graphql-field.md`
