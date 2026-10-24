# notification_inbox

## What it is

The unified notifications inbox: the viewer's pending notifications grouped
by the entity they are filed under and cut into rows (one per conversation
thread, channel top level, email thread, task, pull request, request or
agent session). Built on the shared feed layer, `crates/attention_feed`.

## Start here

- `src/domain/rows.rs`: the row rules — every notification's home row,
  one message one row, noise hidden in its natural row.
- `src/domain/service.rs`: page, recompute, done, seen and undo.
- `src/domain/policy.rs`: which groups the inbox lists.

## Scope

- Owns: row kinds, row ids (`<group id>#<slot>`), shown and hidden
  notifications, row state and revision, inbox membership.
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
- Row contents must not depend on the scope; scopes only filter rows, so the
  web cache can normalize rows by id across inboxes.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-notification-kind.md`
