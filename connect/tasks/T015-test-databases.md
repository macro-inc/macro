# T015: Connect's database tests don't inherit Macro's template

Base: `eric/macro-connect` (PR #9231). CI's `test` job fails three
`connect_api` tests with `failed to apply migrations: VersionMissing(1)`.

## Cause

CI runs `just setup_test_template`, which applies Macro's migrations to
Postgres `template1` so every `#[sqlx::test]` database starts pre-migrated
(`tooling/just/rust.just`, `code_check_cloud_storage.rs` `prepare_tests`).
Connect's tests use `#[sqlx::test(migrator = ...)]`, so their databases start
with Macro's schema and `_sqlx_migrations`, and Connect's migrator rejects
them. Locally `template1` is clean, so they pass.

## Do

1. Replace `#[sqlx::test(migrator = ...)]` in `connect_api` with a test
   helper (in a `test_support` module compiled only for tests) that creates a
   uniquely named database `WITH TEMPLATE template0` on the server in
   `DATABASE_URL`, runs Connect's migrator, hands the pool to the test, and
   drops the database afterwards (also when the test panics, e.g. a guard
   whose `Drop` schedules the drop, or drop stale `connect_test_%` databases
   at helper start). Tests stay `#[tokio::test]` and read naturally.
2. Keep every existing assertion; only the database setup changes.
3. Note in `connect/services/connect_api/AGENTS.md` (Gotchas) why Connect's
   tests create databases from `template0`.

## Done when

- Locally, with `template1` pre-migrated the way CI does it: create a scratch
  Postgres database server state by running `just setup_test_template`
  against a throwaway local server or a database URL whose `template1` you
  may modify (do not touch the shared `macrodb`), then
  `cargo nextest run --all-features -p connect_api` passes. If you can't
  reproduce CI's template locally, say so and explain why the helper is
  immune to it.
- Without the pre-migrated template, the same tests pass.
- clippy (`-D warnings`), `cargo x deps --check`, `just check` pass.

## Out of scope

CI workflow changes; other crates.

## Result
