# macro_db_client

## What it is

Belongs to shared infrastructure: the database client crate for MacroDB
(Postgres), owning its migrations and most of the compile-time-checked
queries used across Rust services.

## Start here

- `src/lib.rs`: the module list — one module per table/feature area
  (`user.rs`, `document.rs`, `organization.rs`, `team/`, `item_access/`, ...).
- `migrations/`: MacroDB's SQLx migrations, paired `.up.sql`/`.down.sql`, 500+
  files; the only place MacroDB schema changes are made.
- `tests/`: cross-table integration tests (e.g. `add_forms.rs`).

## Scope

- Owns: MacroDB's schema (`migrations/`) and the `sqlx::query!` call sites for
  the tables listed in `src/lib.rs`.
- Not here: domain logic, authorization decisions, or caching built on top of
  these queries — those live in the owning domain crate/service that calls in.

## Boundaries

- Depends on: `entity_access_db_utils`, `entity_registry_db_utils`,
  `models_permissions`, `models_entity_access_management`, `model`, `model-entity`.
- Used by: most Rust services and several domain crates (e.g. `documents`,
  `ai_tools`, `authentication_service`, `email_service`); a query here is
  widely shared — check callers before changing a function's signature.

## Recipes

- Add a column or table: `sqlx migrate add --source crates/macro_db_client/migrations <name>`
  → edit the generated `.up.sql`/`.down.sql` → the module in `src/<area>.rs`
  (or `src/<area>/`) → `nix develop --command just prepare_db`.
- Add a query to an existing table: the module in `src/<area>.rs` → its tests
  → `nix develop --command just prepare_db` if cache metadata is missing.
- Add a new owned area: `src/<area>.rs` → `pub mod <area>;` in `src/lib.rs` →
  gate it behind a Cargo feature in `Cargo.toml` only if it's optional (see
  `account_merge_request`, `team`).

## Checks

- `cargo test -p macro_db_client` (`SQLX_OFFLINE` unset; requires local MacroDB
  — `just setup_macrodb`).
- After schema or query changes: `nix develop --command just prepare_db` from
  the repo root, then commit the regenerated root `.sqlx/`.

## Gotchas

- Migrations deploy before service code: never drop a column/table in the
  same PR that removes its last usage (see `docs/development/database.md`).
- Never hand-edit `.sqlx/query-*.json` or invent a migration timestamp.
- Keep concurrent index migrations to one statement with `-- no-transaction`;
  build replacement indexes before dropping old constraints, and validate large
  table checks in a later transaction. See the Outlook rollout notes in
  `docs/design/outlook-email-support.md` for failure recovery and deployment order.
- Quote and alias camelCase columns to Rust field names
  (`SELECT "userId" AS user_id`); don't guess spelling — check `migrations/`.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md` ·
  Docs: `docs/development/database.md` · Skill: `dump-schema`
