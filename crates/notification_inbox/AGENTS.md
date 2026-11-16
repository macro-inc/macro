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
  stack), clear, seen and undo.
- `src/domain/service.rs` (`start_clear`, `run_clear`, `undo_clear`,
  `claim_stalled_clears`): a clear as a stored action applied in chunks. Its
  storage is `notification::domain::bulk_action::BulkActionStore`.
- `src/domain/ports.rs` and `src/outbound/`: clear updates to the viewer's
  sessions over the connection gateway (feature `outbound`).
- `src/domain/policy.rs`: which groups the inbox lists.

## Scope

- Owns: row kinds, row ids (`<group id>#<slot>`), shown and hidden
  notifications, row state and revision, inbox membership.
- Not here: paging, refill, done/seen/undo plumbing, live batching and
  adapters → `crates/attention_feed`; GraphQL → `crates/graphql_notification_inbox`;
  candidate SQL and access gates → `crates/soup` (`attention.rs`).

## Boundaries

- Depends on: `attention_feed`, `notification` (the bulk action store port),
  `item_filters`, `filter_ast`, `model_notifications`.
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

- `cargo test -p notification_inbox --all-features`. The store's own
  transactions are tested against Postgres in `notification`
  (`cargo test -p notification bulk_action`).

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
- A clear belongs to the server, not the request. `start_clear` stores it
  with its scope and start time frozen; `run_clear` applies it a chunk at a
  time, each chunk one transaction (state, ledger, cursor) under a lease. A
  run that stops is claimed again by `claim_stalled_clears` and continues
  from the cursor, so never keep clear progress in memory or outside that
  transaction.
- A clear names its row kinds. An `InboxScope` with no kinds lists every kind
  for pages; for a clear it is refused, so hiding every kind clears nothing.
- A clear covers the inbox as it was when it started: notifications newer
  than `as_of` are filtered out before rows are cut. Groups that new activity
  moves ahead of the walk are picked up by the recheck pass.
- Undo restores each notification's earlier state from the ledger and skips
  those whose state changed since (`user_notification.done_by`). It takes the
  clear's lease, which is what stops a clear still running.
- An unread scope filters on each row's `unseen`, which follows the row's own
  rule (mail by its unread messages), so a row leaves or returns through the
  same recompute as any other change.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-notification-kind.md`
