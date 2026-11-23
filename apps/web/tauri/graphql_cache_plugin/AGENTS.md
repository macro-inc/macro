# graphql_cache_plugin

## What it is

The native Tauri IPC adapter for the shared normalized GraphQL cache. It owns
one locked engine across webviews; cache policy belongs in `cache-core`.

## Start here

- `src/commands.rs`: IPC parsing and change notifications. `open_cache` adopts the bundle's schema on every open (`graphql_cache.native.adopt_schema`); a tier that fails or runs out of space resets the cache logically, and a corrupt file, an uncertain write or a cache that cannot even reset is replaced and opened empty. An older build's `schema.json` is read only as the schema of a cache that stores none, then removed; one that exists but cannot be read resets that cache (`Unrecorded::Unreadable`).
- `src/engine.rs`: engine locking, merging a live webview's schema (recorded in storage; a changed shape is refused until the next open), and shared-core calls.
- `src/engine/idle.rs`: the idle WAL checkpoint. After the engine has been quiet for 100 ms (`access.rs` counts guard releases) it calls `TursoStorage::checkpoint_if_due` under a try-lock that also yields to a waiting hydrate, so a held or queued command always goes first. The task holds only a weak reference while it waits and counts every strong one it takes (`IdleHolds`); `shutdown` stops idle work and waits out a counted hold before it closes Turso, while any other handle still fails it at once.
- `src/engine/people.rs`: scoped context, bounded person search, label-reference reads and local SQL (`graphql_cache_people_read_sql`); distinct `graphql_cache_people_*` commands make native capability explicit. Missing SQL or reference commands do not disable existing context/search commands. SQL returns only final storage-side results and never emits hydration hints or invokes a server query. JS emits only hydration hints after committed context writes; it never substitutes an unscoped write. Person search replies include `nextCursor`; rebuild native code when updating that contract, and do not interpret an older missing cursor as exhaustion.
- `src/engine/soup.rs`: composition of Soup-specific projection adapters.
- `src/engine/authority.rs`: durable CRM retirement and one blanket response-generation comparison under the owner lock. Reads do not require permission proof. Register `graphql_cache_current_authority` and `graphql_cache_transition_authority` with every native binary that receives this web bundle. Missing transition capability requires an app update. Queue inspection exposes authored command metadata without copied response snapshots. Claim, defer, rollback and inspection do not take a response generation; they act only on authored queue state.
- `src/engine/test.rs` and `src/engine/test/`: native persistence and IPC contracts.

## Scope

- Owns: native storage lifetime, operation IDs, IPC results, and event fanout.
- Not here: CRM retirement selection → `crates/soup_filter_cache_adapter`.
- Used by: `apps/web/src/lib/graphql-cache/host/tauri-host.ts`.

## Checks

From the repository root:

- `nix develop .#tauri-linux --command cargo test --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin` (unset `SQLX_OFFLINE`).
- Format through the Tauri workspace manifest, not the root workspace.

## Gotchas

- `graphql_cache_contact_snapshot` and `graphql_cache_contact_reconcile` reuse the existing engine and exact-lookup backfill lane; return only bounded IDs/scalar progress and publish committed invalidations after removals. Older binaries must explicitly refuse this capability without disabling context/search.
- Hold the engine lock, or the turn, across scoped hydration's generation/identity/contact-fence check and
  write. A stale background response must not clear or rebind the current account. `hydrate_query` gives the engine to reads only (`yield_to_reads` keeps its turn; `access.rs`) after the authoritative rows, after each projection pass (`WritePasses` steps; it stops stepping and runs whole once the WAL moved) and again after staging its write, and writes the staged result only when the WAL position and `staged_hydrate_current` are unchanged; otherwise it rechecks the session and runs whole. Every non-read command takes the turn, and a read that arrives after a command still waiting for its turn follows it. Warming hydrates and idle work wait by notification, not in the locks' queues: whatever gives back the turn or a lock Tokio handed it, cancelled or not, wakes them (`Wake`, `wake_if_dropped`), and a warming hydrate never holds the turn while it waits for the engine.
- A timed read the webview gives up on still runs: Tauri cannot cancel a command. Timed commands carry a `requestId` and `graphql_cache_abandon` names it on timeout; a command on `ready_read` keeps its place in the queue and, on its turn, finishes any interrupted retirement and gives the engine back without reading (`engine/abandon.rs`), so after a stall reads nobody waits for do not hold the engine ahead of live ones. An abandoned read of an operation registers it against every change and drops its retained watch (`Engine::register_operation_broadly`) in place of the dependencies it would have registered. Other timed commands (revision, storage generation, mutation inspection) ignore the id, and so does a live-view release. A read marked after it started reading finishes. Older binaries ignore the id; older bundles never send it.
- OTA JS cannot add native policy: scoped hydration requires projection 5 and
  the distinct `graphql_cache_hydrate_scoped` command. Never fall back to the
  deployed unscoped command after a guarded-write failure. Register new commands
  in `../src-tauri/src/lib.rs` as well as defining their plugin handler.
- Keep `apps/web/tauri/Cargo.lock` current when shared client dependencies change.
- Preserve the deployed command contract when an older bundle omits `generation`; reject older supplied generations under the shared owner lock. New bundles always stamp response writes and require the transition capability. Cover legacy omission through the registered invoke handler, including a subsequent read. Native build floors protect new bundles on old binaries, not old bundles on new binaries.
- Resume incomplete retirement before retained live-view reads. Publish generation changes under the owner lock, including recovery and account replacement, so an older notification cannot reactivate a retired generation. First account binding without a stored policy preserves the generation and emits no transition for stamped writes. Publish the shared core's cached authority after the atomic account/authority write; do not turn a committed write into a failure with post-commit storage I/O.
