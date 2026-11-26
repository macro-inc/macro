# graphql_email

## What it is

Backs the Email feature: the GraphQL inbound adapter exposing message object
types, the `EmailThread` edge resolvers, and draft mutations.

## Start here

- `src/objects.rs`: `GraphqlSoupEmailMessage`, `GraphqlMailPreviewMessage`, and
  the loaders that fetch message bodies vs. previews.
- `src/send.rs`: idempotent send/cancel/status plus actor/inbox-scoped pending-send pagination.
- `src/mutation.rs`: `GraphqlEmailMutation` (save/delete draft, mark seen/unread,
  update label).
- `src/loaders.rs`: DataLoader batching for thread metadata, mail projection,
  and content, keyed by thread/message id.
- `src/user_query.rs` / `src/user_objects.rs`: viewer-scoped email settings
  (labels, links, sync status) separate from message content.

## Scope

- Owns: GraphQL types and resolvers for email messages, threads, drafts, and
  viewer email settings.
- Not here: email sync, sending, and storage — `crates/email`; thread
  membership in Soup → `crates/graphql_soup`.

## Boundaries

- Depends on: `email` (ports only), `email_utils`, `entity_access`,
  `graphql_common`.
- Used by: `complete_graph` (schema composition), `graphql_soup` (email edge).

## Recipes

- Add a field to a message/thread type: `src/objects.rs` → its loader in
  `src/loaders.rs` if the field needs a new fetch.
- Add a draft mutation: `src/mutation.rs` → `EmailMutationService` port (in
  `email`) → the service implementation that backs it.

## Checks

- `cargo test -p graphql_email` (`SQLX_OFFLINE` unset).

## Gotchas

- The content loader's cost cap is per batch (`EmailContentLimits`): one
  operation gets 20 threads and 100 messages, a streamed sync page 500 and
  10,000.
- The metadata and Mail projection loaders are `HashMapCache` loaders with the
  cache off (`DataLoader::new` would have no cache at all). Only query-only
  requests turn it on, so `graphql_soup` can prefetch a page's threads in one
  batch: subscription data outlives a payload, and a mutation request may read
  a thread before and after changing it.

## Related

- Rules: `.agents/rules/rust/architecture.md`
