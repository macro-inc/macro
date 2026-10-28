# email_sfs_delete_handler

## What it is

Part of Email's attachment storage cleanup. A Lambda, triggered daily by
EventBridge, that finds orphaned static file service (SFS) email attachments
and enqueues delete messages for the SFS delete worker.

## Start here

- `src/handler.rs`: queries `email_attachments_sfs` for rows with a NULL
  `attachment_id` and publishes `SFSDeleteMessage`s.

## Scope

- Owns: detecting orphaned SFS attachment rows and enqueuing their deletion.
- Not here: actually deleting from SFS or the DB row → the SFS delete worker
  in `email_service` (`src/pubsub/sfs_deleter`).

## Checks

- `cargo test -p email_sfs_delete_handler` (`SQLX_OFFLINE` unset).
