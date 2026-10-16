# sha_cleanup_worker

## What it is

Shared infrastructure for document/attachment storage: a periodic worker
that deletes S3 objects whose SHA was placed in the `bucket:sha-delete`
Redis set, decrementing a shared reference count first.

## Start here

- `src/process.rs`: the cleanup loop — pulls SHAs from Redis, checks the
  count, deletes from S3 when it hits zero.
- `src/service/redis/{get_shas,increment,remove_set_member}.rs`: the Redis
  operations this service makes.
- `src/service/s3/delete.rs`, `src/service/db/get_sha_count.rs`: the S3 delete
  and the Postgres reference-count lookup.

## Scope

- Owns: draining the sha-delete Redis set and the S3 deletes it triggers.
- Not here: adding SHAs to that set, or the reference counting itself, which
  happen wherever documents/attachments are written.

## Checks

- `cargo test -p sha_cleanup_worker` (`SQLX_OFFLINE` unset; needs the local
  Postgres and Redis/macrocache up, per `README.md`).

## Gotchas

- `cargo run --features local` bypasses all AWS calls and returns dummy data
  — use it only for wiring checks, not to verify real deletes.
- Triggered on a schedule by `services/worker_trigger`'s ECS `RunTask`, not by
  this crate's own binary running continuously.

## Related

- Rules: `.agents/rules/rust/guardrails.md`
