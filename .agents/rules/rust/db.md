---
description: "Rust database rules: ids, keys, migrations, and SQLx."
paths:
  - "**/outbound/**"
  - "crates/*_db_client/**"
  - "crates/*db_utils/**"
  - "**/migrations/**"
  - "**/*.sql"
globs: "**/outbound/**,crates/*_db_client/**,crates/*db_utils/**,**/migrations/**,**/*.sql"
alwaysApply: false
---

# Database and migrations

Rust database rules: ids, keys, migrations, and SQLx.

- **CS-01** Generate ids as UUIDv7 in application code — never
  `gen_random_uuid()` (UUIDv4); v7 ids sort by creation time.
- **CS-02** Make seed/backfill inserts and anything that can race idempotent
  with an `ON CONFLICT` handler.
- **CS-03** Prefer natural/composite keys over surrogate ids when the table is
  queried/sorted by those columns anyway, and key REST routes on the natural id.
- **CS-04** Name user columns `user_id` — not `owner_user_id` or other variants;
  follow existing tables.
- **CS-05** New tables need a deliberate cascade/cleanup story, not whatever the
  default happens to be.
- **CS-06** Don't add redundant indexes — a column already covered as the
  leading part of the primary key does not need its own index.
- **CS-07** Don't store columns that are implicit in context (e.g. a scoping id
  already fixed per durable object / per tenant).
- **CS-08** Use `sqlx::query!` / `query_as!` (compile-time checked) by default;
  the non-macro form is only for queries that genuinely cannot be statically
  known. Enforced by clippy `disallowed-methods`; see the [database
  guide](../../../docs/development/database.md).
- **CS-09** The `.sqlx` cache lives at the workspace root — run `nix develop
  --command just prepare_db` from the repository root; never commit a `.sqlx`
  directory inside an individual crate. See the [database
  guide](../../../docs/development/database.md).
- **CS-70** Migrations survive a rolling deploy: new `NOT NULL` columns get a
  default, and changes to large tables set `lock_timeout` and use `NOT VALID` +
  `VALIDATE` or `CREATE INDEX CONCURRENTLY` instead of a full rewrite.
