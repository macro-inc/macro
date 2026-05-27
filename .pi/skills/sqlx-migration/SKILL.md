---
name: sqlx-migration
description: Create SQLx migration files with `sqlx migrate add <name>`. Use when asked to add, create, or generate a sqlx/sqlx-cli database migration.
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# SQLx Migration

Use the SQLx CLI to create migration files instead of manually creating timestamped files.

## Instructions

1. Identify the project or crate root where SQLx migrations should live.
   - Prefer the directory that contains an existing `migrations/` directory.
   - If there are multiple crates/projects, ask the user which one unless the target is obvious.
2. Convert the requested migration description to a short snake_case name, for example `create_users_table`.
3. Run `just rust/cloud-storage/setup_test_envs` from the project root
4. Run the SQLx CLI from `rust/cloud-storage/macro_db_client` folder:

   ```bash
   cargo sqlx migrate add name_of_migration
   ```

   Replace `name_of_migration` with the actual snake_case migration name.
5. Do not manually add timestamps or hand-create migration filenames; `sqlx migrate add` generates the correct timestamped file.
6. After the command succeeds, read the generated migration file and add the requested SQL changes there.
7. If `sqlx` is not installed or not on `PATH`, stop and tell the user to install `sqlx-cli` rather than manually creating the migration file.
