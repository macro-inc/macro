# email_refresh_handler

## What it is

Email feature: Lambda, triggered hourly by EventBridge, that re-subscribes a
slice of Gmail inboxes to push notifications, queues grant health probes,
and schedules deletion of unused/inactive links and of links whose owner's
account is gone. It enqueues
`LinkManagerMessage`s for `email_service` to process, all as
`LinkManagerSender::Sweep`, so they go to the link manager's maintenance
queue (`LinkMaintenanceQueue`) and never delay a person's removal.

## Start here

- `src/handler.rs`: preserves the Lambda span and calls the domain service.
- `src/domain/`: scheduling, fanout and failure policy behind repository/queue ports.
- `src/outbound/`: the five PostgreSQL queries and existing SQS wrapper.
- `src/composition.rs` / `src/config.rs`: adapter wiring and environment setup.

## Scope

- Owns: selecting due Gmail refreshes, health probes and link deletions, and
  publishing their SQS messages.
- Not here: actually calling the Gmail `users.watch` endpoint → the
  link-manager consumers in `email_service` (`src/pubsub/link_manager`).

## Checks

- `cargo nextest run -p email_refresh_handler --all-features -j 8`
  (`SQLX_OFFLINE` unset).

## Gotchas

- Preserve the independent clock reads, concurrent refresh/health work, and
  fresh production/hour-5 deletion gate.
- Deletion reads both groups first, then sends unused before inactive IDs.
- Query and send failures are logged and swallowed; the Lambda returns success.
- Keep signed casts, SQL hash expressions, result order and strict age cutoffs unchanged.
- The ownerless sweep runs every hour in every environment, at most 100 links
  per run, and logs `ownerless_links`. Account deletion's own `DeleteUser` is
  not retried (FusionAuth never redelivers `user.delete.complete`) and only
  finds links whose credentials the deleted account held. Its predicate relies
  on every live link's owner being a "User" row; a promoted shared mailbox's
  row is deleted only after its link. Keep it that way for any new owner kind.
