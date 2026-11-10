# notification_inbox

## What it is

The unified notifications inbox: the viewer's pending notifications grouped
by the entity they are filed under and cut into rows (one per channel thread,
channel top level, entity's comments, email thread, task, pull request, request,
agent session or runtime). Built on the shared feed layer, `crates/attention_feed`.

## Start here

- `src/domain/rows.rs`: the row rules — every notification's home row,
  one message one row, one stack per top-level message and per entity's
  comments, noise hidden in its natural row.
- `src/domain/service.rs`: page, recompute, done (of rows or of one notification of a
  stack), seen and undo.
- `src/domain/policy.rs`: which groups the inbox lists.

## Scope

- Owns: row kinds, row ids (`<group id>#<slot>`, or `<group id>#noise#<slot>`
  for a row of the Noise lane), shown and hidden notifications, row state and
  revision, inbox membership.
- Not here: paging, refill, done/seen/undo plumbing, live batching and
  adapters → `crates/attention_feed`; GraphQL → `crates/graphql_notification_inbox`;
  candidate SQL and access gates → `crates/soup` (`attention.rs`).

## Boundaries

- Depends on: `attention_feed`, `item_filters`, `filter_ast`,
  `model_notifications`.
- Used by: `graphql_notification_inbox`, `document_storage_service`
  (composition).

## Recipes

- Give a new notification kind a row: `place_event` (or the channel and
  discussion rules) in `src/domain/rows.rs` → a row type in
  `src/domain/models.rs` → `graphql_notification_inbox` inputs → a test in
  `rows/test.rs`. The `place_event` match is exhaustive on purpose.
- Offer a button on a row: `actions` in `src/domain/rows.rs` →
  `InboxRowActionKind` → its GraphQL enum. The client performs the action
  through the API of what it acts on.

## Checks

- `cargo test -p notification_inbox`

## Gotchas

- Groups use `CandidateKeying::FiledEntity`: a channel's group holds its
  threads, so channel rows partition the whole channel's notifications.
- Row types, actor kinds and action kinds only grow: add values, never
  repurpose or remove them; clients skip values they do not know.
- Only rows have an `id` in GraphQL; the client cache reads any `id` field as
  entity identity and requires `ID!`, so other inbox types use other names
  (`groupId`, `principalId`, `targetId`).
- Row contents must not depend on the scope's row types or unread filter;
  those only filter rows, so the web cache can normalize rows by id across
  inboxes. The lane is different: the same slot holds other notifications in
  each lane, so the lane is part of the row id, and done, seen and
  notification-done find a row in the lane its id names. The changes they
  return describe the scope's lane alone; a row of the other lane is still
  acted on and reaches its own inbox through live updates.
- "Noise" in `rows.rs` (low-value kinds hidden inside a row) is unrelated to
  the Noise lane and applies in either lane.
- An unread scope filters on each row's `unseen`, which follows the row's own
  rule (mail by its unread messages), so a row leaves or returns through the
  same recompute as any other change.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-notification-kind.md`
