# graphql_channel

## What it is

The GraphQL inbound adapter for channels: the channel activity mutation and
the channel message reads (timeline page, thread reply page, changes after a
sequence number) that the device cache keeps a channel current with.

## Start here

- `src/lib.rs`: the activity mutation.
- `src/messages.rs`: `channelMessages(channelId)` and its `timeline`,
  `thread` and `changes` fields, their inputs and cursors.
- `src/messages/reads.rs`: `ChannelMessageReads`, the type-erased port the
  fields call, and its implementation over `messages::MessageService`.
- `src/messages/objects.rs`: the GraphQL message, thread, activity and page
  types.

## Scope

- Owns: GraphQL shapes and argument validation for channel reads.
- Not here: message rules, paging SQL and the change sequence → `crates/messages`;
  timeline facts → `crates/activity`; membership checks → `crates/entity_access`.

## Boundaries

- Depends on: `messages` (ports), `activity`, `entity_access`, `channels`.
- Used by: `complete_graph` (flattens the reads onto the authenticated user),
  `document_storage_service` (builds `ChannelMessagesGraphqlContext`).

## Recipes

- Add a message field: `crates/messages` model → `src/messages/objects.rs` →
  the REST-parity test in `src/messages/test.rs`, then regenerate the schema
  ([guide](../../docs/guides/add-graphql-field.md)).

## Checks

- `cargo test -p graphql_channel` and `cargo test -p complete_graph`.

## Gotchas

- Every page read returns `seq`, read before the page. Reading it after would
  let a write land between the two and be skipped by the client's next
  `changes(since: seq)`.
- `GraphqlChannelMessages` has the channel's id so a client cache keeps one
  record per channel, with that channel's pages on it; flattening the reads
  onto the user would put every channel's pages on the user record. Access
  is checked by each read, not by `channelMessages`.
- A message field carries the value the REST timeline returns for it, with the
  same timestamp format; `a_timeline_page_carries_every_value_the_rest_route_returns`
  compares the two value for value. The REST route stays until the web client
  no longer reads it.
- A timeline cursor is a position (`createdAt`, `entryId`), the REST cursor
  field for field, and has no `id` so a client cache does not keep it as an
  entity: the client compares rows against it to place a pushed row in
  the pages it holds. A reply cursor is opaque base64 JSON, and a client
  never builds one. Either that does not parse is `BAD_USER_INPUT`.
- A thread page carries its root only for a window read without a cursor.
- The context is type-erased (`Arc<dyn ChannelMessageReads>`) so the schema
  gains no generic; `for_organization` scopes it per request.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-graphql-field.md`
