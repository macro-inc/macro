# email_scheduled_handler

## What it is

Email feature: Lambda, triggered every minute by EventBridge, that finds
scheduled email drafts whose `send_time` has passed and publishes a
`ScheduledPubsubMessage` per draft for `email_service` to actually send.

## Start here

- `src/handler.rs`: `fetch_pending_scheduled_messages` query + publish loop;
  `README.md` explains the trigger cadence and the `scheduled_messages` table.

## Scope

- Owns: finding due scheduled sends and enqueuing them exactly once.
- Not here: sending the email itself, or the enqueue-failure recovery path →
  `email_service`'s scheduled message worker (`src/pubsub/scheduled`).

## Checks

- `cargo test -p email_scheduled_handler` (`SQLX_OFFLINE` unset).

## Gotchas

- #6617 reverted a "replay historical sends" change and #6580 fixed a send
  stranded by a failed enqueue — read those commits before changing the
  fetch/publish ordering (`git log -- services/email_scheduled_handler`).
