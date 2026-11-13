# graphql_channel

## What it is

The GraphQL inbound adapter for channels: the channel activity mutation, the
channel message reads (timeline page, thread reply page, changes after a
sequence number) that the device cache keeps a channel current with, and the
channel message writes (post, edit, delete, react) its durable mutation queue
sends, each returning the sequence number it took.

## Start here

- `src/lib.rs`: the activity mutation.
- `src/messages.rs`: `channelMessages(channelId)` and its `timeline`,
  `thread` and `changes` fields, their inputs and cursors.
- `src/messages/reads.rs`: `ChannelMessageReads`, the type-erased port the
  fields call, and its implementation over `messages::MessageService`.
- `src/messages/objects.rs`: the GraphQL message, thread, activity and page
  types.
- `src/messages/mutations.rs`: `ChannelMessageMutationRoot`
  (`postChannelMessage`, `editChannelMessage`, `deleteChannelMessage`,
  `reactToChannelMessage`), their inputs and the `GraphqlChannelMessageWrite`
  payload.
- `src/messages/writes.rs`: `ChannelMessageWrites`, the type-erased port the
  mutations call, and its implementation over `messages::MessageService`.

## Scope

- Owns: GraphQL shapes and argument validation for channel reads and writes.
- Not here: message rules, paging SQL and the change sequence → `crates/messages`;
  timeline facts → `crates/activity`; membership checks → `crates/entity_access`.

## Boundaries

- Depends on: `messages` (ports, inbound for the REST sender attribution),
  `entity_access` (ports, inbound for the REST receipt functions),
  `macro_authorization`, `activity`, `channels`.
- Used by: `complete_graph` (flattens the reads onto the authenticated user,
  merges `ChannelMessageMutationRoot` into the mutation root),
  `document_storage_service` (builds `ChannelMessagesGraphqlContext`, and
  scopes it per request with `for_organization` and `with_caller`).

## Recipes

- Add a message field: `crates/messages` model → `src/messages/objects.rs` →
  the REST-parity test in `src/messages/test.rs`, then regenerate the schema
  ([guide](../../docs/guides/add-graphql-field.md)).
- Add a message write: a `MessageService` method returning `Sequenced` →
  `ChannelMessageWrites` and `ServiceWrites` in `src/messages/writes.rs` → the
  mutation in `src/messages/mutations.rs` → resolver tests in
  `src/messages/test/writes.rs` and the composed test in
  `crates/complete_graph/src/schema/test/channel_messages.rs`.

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
- The context is type-erased (`Arc<dyn ChannelMessageReads>`,
  `Arc<dyn ChannelMessageWrites>`) so the schema gains no generic;
  `for_organization` and `with_caller` scope it per request.
- The writes authorize exactly as the REST message routes: they mint the
  receipt with the same `entity_access` functions (a new post with
  `message_sender_entity_access_receipt`, every other write with
  `principal_entity_access_receipt`) from the request's `MacroAuthorization`,
  which document storage puts on the context with `with_caller`. They run the
  `MessageService` code the REST routes run (`post_once` and `delete_once`
  add only the replay check), so they publish the same events. A request
  without a caller is `FORBIDDEN`.
- Every write is safe to send again: a post with an id its sender already
  posted in that channel and thread returns that message, and a delete of a
  deleted message returns its tombstone, both with a null `seq` and no event
  (`MessageService::post_once`, `delete_once`). A reaction already as asked
  returns a null `seq`; an edit edits again. A post without an id has no
  replay protection.
- A refused write carries `extensions.code`: `BUSY` (nothing was written; the
  only one a client may retry), `NOT_FOUND`, `FORBIDDEN`, `BAD_USER_INPUT`,
  `CONFLICT` (an id another sender, thread or channel holds), or
  `INTERNAL_SERVER_ERROR` with the cause only in the log. Reads share the
  mapping (`message_error`).
- A write returns the message the `MessageService` write returned, as the
  REST write routes do, and never reads it again: re-reading a root costs a
  scan of its whole thread on every write. So `thread` and `call` are always
  null in a write payload, even on a root; clients read them from the pages.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-graphql-field.md`
