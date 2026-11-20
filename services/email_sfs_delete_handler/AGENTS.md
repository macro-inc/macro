# email_sfs_delete_handler

## What it is

Part of Email's attachment storage cleanup. A Lambda, triggered daily by
EventBridge, that finds orphaned static file service (SFS) email attachments
and enqueues delete messages for the SFS delete worker.

## Start here

- `src/handler.rs`: preserves the Lambda span and delegates to the domain service.
- `src/domain/`: orphan cleanup policy, repository and queue ports, and unit tests.
- `src/outbound/`: the PostgreSQL orphan query and SQS message adapter.
- `src/composition.rs`: connects the adapters to the service and context.

## Scope

- Owns: detecting orphaned SFS attachment rows and enqueuing their deletion.
- Not here: actually deleting from SFS or the DB row → the SFS delete worker
  in `email_service` (`src/pubsub/sfs_deleter`).
- Preserve query order and sequential sends; query errors become an empty batch,
  queue errors do not stop later sends, and the Lambda returns success.

## Checks

- `cargo nextest run -p email_sfs_delete_handler --all-features -j 8`
  (`SQLX_OFFLINE` unset).
