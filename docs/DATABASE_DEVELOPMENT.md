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

## Safe database schema changes

### Entity tables and reusable storage

New app entities use a plural `<kind>_entities` table for identity, display name,
ownership, lifecycle timestamps, and trash state. When an entity uses a reusable
storage resource, its entity table references that resource with a foreign key;
storage must be usable without creating the app entity or its access grants.

This convention starts with `database_entities`; it is new for databases and is
the convention for new entities going forward. It does not require renaming
existing entity tables. `database_entities.database_id` is both the entity's key
and a reference to `databases.id`. See the
[database backend](../crates/databases/README.md) for the storage boundary and
the explicitly destructive database cutover.

### Compatible migrations

**Database migrations deploy before service changes.** Every migration must remain
compatible with the service code currently deployed, not just the code in its PR.

- **Never drop a column in the same PR that removes its usage.** First remove all
  reads/writes in a service-only PR and keep the column in the schema. After that
  change is fully deployed to all consumers, drop the column in a separate PR.
  Merging the first PR is not enough; confirm deployment before removal.
- Apply the same staged approach to table removals, column renames, and other
  incompatible changes: add compatible schema, migrate service usage, then remove
  obsolete schema in a later PR after deployment.
- New columns and constraints must also support currently deployed code (for
  example, allow omitted values via nullability or defaults until writers migrate).

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

### Slack archive migration on PostgreSQL 14

Migration `20260930171728` originally used PostgreSQL 15's `NULLS NOT DISTINCT`
syntax, which failed on production PostgreSQL 14. The repaired migration uses
an ordinary unique constraint and a partial unique index with equivalent
semantics. Databases that applied the original migration keep their existing
constraint; they do not need a schema rewrite.

The deployment action reconciles only the known original SQLx checksum before
running migrations. For an existing local database that reports a checksum
mismatch for this version, run the same helper with your local `DATABASE_URL`:

```bash
bash crates/macro_db_client/repair-slack-archive-checksum.sh
```

The helper verifies the replacement file's checksum and changes only a successful
history row with the exact original checksum. Unknown checksums and failed rows
remain untouched and are still rejected by SQLx. Never clear migration history
or reset a database to resolve this mismatch.

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
