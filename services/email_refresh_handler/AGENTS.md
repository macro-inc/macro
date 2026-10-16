# email_refresh_handler

## What it is

Email feature: Lambda, triggered hourly by EventBridge, that re-subscribes a
slice of Gmail inboxes to push notifications (each inbox refreshed once per
day) by enqueuing `LinkManagerMessage`s for `email_service` to process.

## Start here

- `src/handler.rs`: picks the due subset of email subscriptions and enqueues
  refresh messages; `README.md` explains the once-per-day cadence.
- `src/context.rs` / `src/config.rs`: DB pool and env setup.

## Scope

- Owns: selecting which Gmail subscriptions are due for a `users.watch` refresh
  and publishing the SQS messages.
- Not here: actually calling the Gmail `users.watch` endpoint → the
  `LinkManagerQueue` consumer in `email_service` (`src/pubsub/link_manager`).

## Checks

- `cargo test -p email_refresh_handler` (`SQLX_OFFLINE` unset).
