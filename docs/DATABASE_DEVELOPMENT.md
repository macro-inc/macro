# Database development

Read this for SQLx queries, migrations, database-backed tests, and cache errors.
Commands run from the repository root inside `nix develop` unless shown with an
explicit Nix invocation. See also [Rust development](RUST_DEVELOPMENT.md).

## Locate the schema and owner

- MacroDB migrations live in [`crates/macro_db_client/migrations/`](../crates/macro_db_client/migrations/).
  Check the owning crate's migrations/recipes before assuming another database
  uses the same setup.
- Inspect migrations or use the [dump-schema skill](../.agents/skills/dump-schema/SKILL.md)
  against the local database. Do not guess table or column spelling.
- Quote camelCase identifiers and alias selected columns to their Rust field
  names: `SELECT "userId" AS user_id FROM "UserInsights"`.
- Use the owning domain's database adapter; follow the style guide's `[db]` rules
  (CS-01–09) and ownership rule (CS-27) in [STYLE_GUIDE.md](STYLE_GUIDE.md).

## Set up local test databases

On a **local machine**, from the root inside Nix:

```bash
just run_dbs -d
just setup_test_envs
just setup_macrodb
```

`run_dbs` creates the required networks/volumes and starts Postgres and Redis.
`setup_macrodb` creates and migrates MacroDB; `initialize_dbs` is its alias.
The default local URL is defined in [database.just](../tooling/just/database.just).
These recipes target that default database, not a named local-stack instance.

On **Cursor Cloud**, installation already prepares the database and test envs.
Start the infrastructure with `bash .cursor/infra.sh`; see [Cursor Cloud](CURSOR_CLOUD.md).
Apply any new migrations before testing.

## Change queries or schema

1. **If the schema changes, generate a migration with SQLx**, never by hand.
   For MacroDB, from the root:

   ```bash
   sqlx migrate add --source crates/macro_db_client/migrations <descriptive_name>
   ```

   Edit the generated file. For another migration directory, use its `--source`
   or run `sqlx migrate add` from its owning crate. Never invent/copy timestamp
   prefixes. If SQLx is unavailable, use the pinned Nix shell or report the blocker;
   do not fabricate a migration filename.

2. **Use compile-time checked queries** (`query!`, `query_as!`, `query_scalar!`,
   `query_file!`) by default. Dynamic SQL is only for genuinely dynamic queries;
   bind values and allowlist dynamic identifiers. Review indexes, bounded results,
   and access-control predicates with the [SQLx query validator](../.pi/skills/sqlx-query-validator/SKILL.md).

3. **Apply schema changes** to the local database:

   ```bash
   just crates/macro_db_client/migrate_db
   ```

4. **Update affected tests/fixtures and run package tests** from the root with
   `SQLX_OFFLINE` unset. Test between batches of query changes, not just at the end.

5. **Refresh the workspace SQLx cache** when queries (including test queries) or
   schema change, or when required metadata is missing. From the repository root:

   ```bash
   nix develop --command just prepare_db
   ```

   Commit generated `.sqlx` changes with the query/schema change. Never manually
   create or edit `.sqlx/query-*.json`, and never generate a crate-local cache.
   Unrelated Rust-only DB-crate edits still need appropriate tests, but do not
   require cache preparation when queries/schema are unchanged and metadata is present.

6. **Rerun the affected tests** after preparation or fixes. Cache preparation is
   not a substitute for `cargo test -p <package>` against the live local database.

### Include test-only queries in preparation

The root `prepare_db` wrapper takes **no flags**. If SQLx needs metadata for
queries compiled only in tests, call the workspace helper from the root. First
set `DATABASE_URL` to your intended local database URL, replacing the placeholders
below with your local connection details:

```bash
export DATABASE_URL='postgres://<user>:<password>@<host>:<port>/<database>'
nix develop --command just sqlx::prepare_db "$DATABASE_URL" --tests
```

The helper in
[sqlx.just](../tooling/just/sqlx.just) forwards `--tests` to Cargo while keeping
workspace scope and the root `.sqlx` directory. Do not run preparation from an
individual crate or try `just prepare_db --tests`.

## Troubleshooting

- **Connection or schema errors:** confirm local Postgres is running, test envs
  point to the intended local database, and migrations have been applied.
- **Missing cached query data:** use the preparation commands above, including
  `--tests` through the helper for test-only queries. Leave `SQLX_OFFLINE` unset
  for `cargo test`; enabling it can hide schema drift and produce misleading
  type-inference errors. Offline mode is only for builds/checks/lints.
- **Preparation still fails:** fix in-scope query/schema issues; if the blocker
  is environmental, report it. Do not hand-edit the cache or wipe databases as
  an automatic workaround.

### Destructive local reset — explicit approval required

Only after confirming the target is the disposable local database and the user
approves losing its data, run from the repository root inside Nix:

```bash
just crates/macro_db_client/drop_db -y -f
just setup_macrodb
```

Do not use this on hosted dev/production databases or delete unrelated containers.
For a named local stack, follow [its instance-specific commands](RUNNING_LOCALLY.md)
so you do not reset the default database by mistake.
