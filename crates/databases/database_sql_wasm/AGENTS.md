# database_sql_wasm

## What it is

The browser build of `database_sql` (the database SQL engine the web app runs in the browser). It holds only the `cdylib`
that wasm-pack builds; the code and its wasm-bindgen exports live in
[`database_sql`](../database_sql/AGENTS.md). Keeping the cdylib here means native
builds of `database_sql` link no shared library, and builds of different
services no longer overwrite each other's uplifted `libdatabase_sql.so`.

## Checks

- `just build-database-sql-wasm` in `apps/web` (wasm-pack, `--out-name database_sql`).
