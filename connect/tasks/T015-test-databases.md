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

### Changed

- `connect/services/connect_api/src/test_support.rs` creates a unique database
  from `template0` using `DATABASE_URL`, applies Connect migrations, and
  force-drops it when the test ends or unwinds.
- `connect/services/connect_api/src/main.rs`, `src/test.rs`,
  `src/oauth_test.rs`, `src/mcp/test.rs`, and `src/outbound/test.rs` use the
  test-only helper in all 12 database tests without changing their assertions.
- `connect/services/connect_api/AGENTS.md` explains the `template0` requirement;
  `connect/docs/decisions.md` describes the current test setup.

### Checks

- `just setup_test_template`: passed on a disposable `pgvector/pgvector:pg14`
  server; `template1` contained 625 Macro migration records. An initial
  disposable PostgreSQL 18 server lacked the `vector` extension, so that
  attempt stopped at migration 20260511131821 before the pgvector rerun.
- `cargo nextest run --all-features -p connect_api`: passed 24/24 with the
  pre-migrated `template1`; passed 24/24 with a clean `template1`. Both
  disposable servers had zero remaining `connect_test_%` databases.
- `cargo clippy -p connect_api --all-features --all-targets -- -D warnings`:
  passed.
- `cargo x deps --check`: passed.
- `just check`: passed, including format, ast-grep, PII scan, and 12 PII
  scanner tests. The first invocation could not launch the pinned ast-grep
  binary on NixOS; the successful run used that same 0.44.1 binary with a
  loader fix in `/tmp`.
- `git diff --check`: passed. Repository audit: passed.

### Open questions

None.

### Proposed commit

`fix(connect): isolate API test databases from template1`

Why:
CI preloads `template1` with a separate migration history, causing
Connect's migrator to reject new test databases.

What:
Create isolated databases from `template0`, apply Connect migrations, and
force-drop them when tests finish or unwind. Use the helper in every database
test and document the setup.
