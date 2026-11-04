# graphql_cache_plugin

## What it is

The native Tauri IPC adapter for the shared normalized GraphQL cache. It owns
one locked engine across webviews; cache policy belongs in `cache-core`.

## Start here

- `src/commands.rs`: IPC parsing and change notifications.
- `src/engine.rs`: engine locking, schema installation, and shared-core calls.
- `src/engine/people.rs`: scoped context, bounded person search, label-reference reads and local SQL (`graphql_cache_people_read_sql`); distinct `graphql_cache_people_*` commands make native capability explicit. Missing SQL or reference commands do not disable existing context/search commands. SQL returns only final storage-side results and never emits hydration hints or invokes a server query. JS emits only hydration hints after committed context writes; it never substitutes an unscoped write. Person search replies include `nextCursor`; rebuild native code when updating that contract, and do not interpret an older missing cursor as exhaustion.
- `src/engine/soup.rs`: composition of Soup-specific projection adapters.
- `src/engine/test.rs` and `src/engine/test/`: native persistence and IPC contracts.

## Scope

- Owns: native storage lifetime, operation IDs, IPC results, and event fanout.
- Not here: authorization or cache admission policy → `crates/client/cache-core`.
- Used by: `apps/web/src/lib/graphql-cache/host/tauri-host.ts`.

## Checks

From the repository root:

- `nix develop .#tauri-linux --command cargo test --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin` (unset `SQLX_OFFLINE`).
- Format through the Tauri workspace manifest, not the root workspace.

## Gotchas

- Hold the engine lock across scoped hydration's generation/identity check and
  write. A stale background response must not clear or rebind the current account.
- OTA JS cannot add native policy: scoped hydration requires projection 5 and
  the distinct `graphql_cache_hydrate_scoped` command. Never fall back to the
  deployed unscoped command after a guarded-write failure. Register new commands
  in `../src-tauri/src/lib.rs` as well as defining their plugin handler.
- Keep `apps/web/tauri/Cargo.lock` current when shared client dependencies change.
