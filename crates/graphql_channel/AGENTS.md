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
  mutation queue; each returns the written `GraphqlChannelMessage`.
- `src/lib.rs`: channel activity mutation and typed read errors.

## Boundaries

- Depends on `messages` and `entity_access` domain ports; no SQL belongs here.
- `complete_graph` flattens the read fields onto `GraphqlUser`.
- DSS inserts `ChannelGraphqlContext` for both HTTP and websocket requests, using
  the same primary-backed messages service as REST.
- Message mutations need a `ChannelWriteActor`, which DSS inserts on HTTP
  requests only, and a personal session: agents, bots and API tokens post
  through REST, where their attribution is decided.

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
  `post_once` (the client id returns the stored message) and delete through
  `delete_once` (the tombstone); edit and react are already repeatable. A root
  is returned with its thread summary so the cached row stays complete.
- `MessageError::Contended` maps to `SERVICE_UNAVAILABLE`; the client retries it.
- Keep `id` for global identities; thread metadata and attachment references are embedded.

## Related

- `docs/guides/add-graphql-field.md`
- `crates/messages/AGENTS.md`
