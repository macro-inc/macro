# graphql_channel

## What it is

GraphQL inbound adapter for authenticated channel message reads, a person's
own message writes, and channel activity mutations. The normalized cache stores `GraphqlChannelMessage`
separately from Soup's thread-root projection.

## Start here

- `src/user_query.rs`: user-scoped timeline, thread, item, and change reads.
- `src/reads.rs`: request context using the REST messages service and access boundary.
- `src/inputs.rs`: lossless microsecond/UUID timeline and import-aware reply cursors.
- `src/objects.rs`: message, thread, call, and activity response mapping.
- `src/writes.rs`: `sendChannelMessage`, `editChannelMessage`,
  `deleteChannelMessage`, `reactToChannelMessage` for the web client's durable
  mutation queue; each returns a `GraphqlChannelMessageWrite`: the written
  message, and for a reply its root with the thread summary that counts it.
- `src/subscription.rs`: `channelTimelineUpdates`, the viewer's live channel
  changes in the `channelChanges` shape, streamed from request data.
- `src/lib.rs`: channel activity mutation and typed read errors.

## Boundaries

- Depends on `messages` and `entity_access` domain ports; no SQL belongs here.
- `complete_graph` flattens the read fields onto `GraphqlUser`.
- DSS inserts `ChannelGraphqlContext` for both HTTP and websocket requests, using
  the same primary-backed messages service as REST.
- Message mutations need a `ChannelWriteActor`, which DSS inserts on HTTP
  requests only, and a personal session: agents, bots and API tokens post
  through REST, where their attribution is decided.
- DSS inserts `ChannelTimelineSubscriptions` over its process-local
  `ChannelTimelineFanout`; the subscription resolver reads no database.

## Checks

- `cargo test -p graphql_channel` with `SQLX_OFFLINE` unset.
- `cargo test -p complete_graph` covers composed-schema parity and the SDL contract.
- Regenerate `static_assets/schema.graphql` after changing fields or types.

## Gotchas

- Read the channel sequence before loading a page so replay cannot skip a racing write.
- Map change pages from `MessageReader::channel_changes`; preserve its reset,
  watermark, coalescing, removed identities, and changed-reply roots.
- Reply keys include `import_order NULLS LAST`; timestamps alone do not describe their order.
- Preserve microseconds in timestamps and cursors; message UUIDs break equal-time ties.
- Message mutations are replayed by the client's queue: send goes through
  `post_once` (the client id returns the stored message), edit through
  `patch_once` (an edit the message already shows writes nothing) and delete
  through `delete_once` (the tombstone); react is already repeatable. Send and
  delete are safe to replay at any time. An edit or reaction replayed after a
  lost response is safe only if the message did not change in between: one
  that lands after a newer edit or reaction from the same person's other
  device undoes it, and the input carries nothing the server could refuse it
  by. The client replays them only after a transport failure. A root
  is returned with its thread summary so the cached row stays complete, and a
  reply (sent, replayed or deleted) with its root, read back on primary after
  the commit. A reply's root that cannot be read back is left out; a written
  root that cannot be read back answers `SERVICE_UNAVAILABLE`, so the queue
  replays the write rather than cache a root without its summary.
- `MessageError::Contended` maps to `SERVICE_UNAVAILABLE`; the client keeps the write queued and retries it without counting a failure.
- Map messages with `GraphqlChannelMessage::from_change` in both the changes
  page and the live update, so the two never diverge.
- Keep `id` for global identities; thread metadata and attachment references are embedded.

## Related

- `docs/guides/add-graphql-field.md`
- `crates/messages/AGENTS.md`
