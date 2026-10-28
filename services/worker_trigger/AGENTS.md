# worker_trigger

## What it is

Shared infrastructure for document/attachment storage cleanup: an
EventBridge-scheduled Lambda that starts an ECS `RunTask` for the
`sha_cleanup_worker` task definition.

## Start here

- `src/main.rs`: the whole Lambda — reads the EventBridge event and invokes
  `service::ecs::run_task`.
- `src/service/ecs/run_task.rs`: the `RunTask` call itself.

## Scope

- Owns: translating an EventBridge schedule tick into one ECS task launch.
- Not here: the cleanup logic that task runs →
  `services/sha_cleanup_worker`.

## Checks

- `cargo test -p worker_trigger` (`SQLX_OFFLINE` unset).

## Gotchas

- `cargo run --features local` (or `cargo lambda watch --features local`)
  skips the real ECS call — only use it to exercise request parsing.

## Related

- Rules: `.agents/rules/rust/guardrails.md`
