# sha_cleanup_worker

## What it is

Shared infrastructure for document/attachment storage: a periodic worker
that drains the Postgres `sha_cleanup_queue` and deletes each queued SHA's S3
object once no `"BomPart"` row references it.

## Start here

- `src/process.rs`: the cleanup loop — reads the queue, counts `"BomPart"`
  references, deletes from S3 when there are none, then dequeues.
- `src/service/db/{sha_cleanup_queue,get_sha_count}.rs`: the queue reads and
  deletes, and the reference count.
- `src/service/s3/delete.rs`: the S3 delete.

## Scope

- Owns: draining `sha_cleanup_queue` and the S3 deletes it triggers.
- Not here: queueing SHAs (`macro_sha_count_client::ShaReferences::release_shas`,
  called wherever docx documents are deleted).

## Checks

- `cargo test -p sha_cleanup_worker` (`SQLX_OFFLINE` unset; needs the local
  Postgres).

## Gotchas

- `cargo run --features local` bypasses all AWS calls and returns dummy data
  — use it only for wiring checks, not to verify real deletes.
- Triggered on a schedule by `services/worker_trigger`'s ECS `RunTask`, not by
  this crate's own binary running continuously.

- A SHA released again while a run is in progress stays queued: dequeuing
  matches its `queued_at` as well as the SHA.

## Related

- Rules: `.agents/rules/rust/guardrails.md`
