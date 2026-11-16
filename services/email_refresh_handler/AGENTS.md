# email_refresh_handler

## What it is

Email feature: Lambda, triggered hourly by EventBridge, that re-subscribes a
slice of Gmail inboxes to push notifications, queues grant health probes,
and schedules deletion of unused/inactive links. It enqueues
`LinkManagerMessage`s for `email_service` to process.

## Start here

- `src/handler.rs`: preserves the Lambda span and calls the domain service.
- `src/domain/`: scheduling, fanout and failure policy behind repository/queue ports.
- `src/outbound/`: the four PostgreSQL queries and existing SQS wrapper.
- `src/composition.rs` / `src/config.rs`: adapter wiring and environment setup.

## Scope

- Owns: selecting due Gmail refreshes, health probes and link deletions, and
  publishing their SQS messages.
- Not here: actually calling the Gmail `users.watch` endpoint → the
  `LinkManagerQueue` consumer in `email_service` (`src/pubsub/link_manager`).

## Checks

- `cargo nextest run -p email_refresh_handler --all-features -j 8`
  (`SQLX_OFFLINE` unset).

## Gotchas

- Preserve the independent clock reads, concurrent refresh/health work, and
  fresh production/hour-5 deletion gate.
- Deletion reads both groups first, then sends unused before inactive IDs.
- Query and send failures are logged and swallowed; the Lambda returns success.
- Keep signed casts, SQL hash expressions, result order and strict age cutoffs unchanged.
