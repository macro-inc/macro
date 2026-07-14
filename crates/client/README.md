# graphql-cache

Normalized GraphQL cache with disk-backed persistence for urql. Design doc:
[`apps/web/docs/graphql-normalized-cache-plan.md`](../../apps/web/docs/graphql-normalized-cache-plan.md).

## Crates

| Crate | Purpose |
|---|---|
| `cache-core` | Pure engine: schema-metadata codegen (build.rs from `static_assets/schema.graphql`), normalize/denormalize, LRU hot tier, dependency index, async `Storage` trait |
| `cache-sqlite` | `Storage` over SQLite — Tauri native host |
| `cache-idb` | `Storage` over IndexedDB via the `idb` crate — browser wasm host (wasm32-only; empty shell elsewhere) |
| `cache-wasm` | wasm-bindgen shell exposing the engine to the browser worker glue (`apps/web/src/lib/graphql-cache/`) |

The Tauri host lives in the tauri workspace (it needs the patched tauri fork
pinned there): `apps/web/tauri/graphql_cache_plugin`, path-depending on
`cache-core`/`cache-sqlite`. Test it from `apps/web/tauri` with
`cargo test -p graphql_cache_plugin` (on NixOS use the `js-app` dev shell —
tauri's Linux desktop stack needs its webkitgtk/dbus system libs).

## Tests

From the repository root (these crates are workspace members; use
`SQLX_OFFLINE=true` as usual):

```sh
SQLX_OFFLINE=true cargo test -p cache-core -p cache-sqlite   # native
cargo check --target wasm32-unknown-unknown -p cache-idb -p cache-wasm --all-targets
wasm-pack test --headless --chrome crates/client/cache-idb   # browser tests (IDB backend)
```

NixOS note: wasm-pack downloads a dynamically-linked chromedriver that won't
run. Work around by invoking the runner directly with a nix chromedriver:

```sh
cd crates/client/cache-idb
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=~/.cache/.wasm-pack/wasm-bindgen-*/wasm-bindgen-test-runner \
CHROMEDRIVER=$(command -v chromedriver || echo /nix/store/*undetected-chromedriver*/bin/undetected-chromedriver) \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown
```

## Key policy

**Presence-of-id convention**: an output object type with an `id: ID!`
field is a normalized entity keyed by `__typename:id`; a type without `id`
is embedded inline in its parent record. The schema itself is the policy —
there is no client-side key config. The build fails on malformed shapes
(nullable/non-ID `id`, `id` on the query root). Consequence for schema
authors: **only expose a field named `id` when it is the object's global
identity** (e.g. `GraphqlProperty` exposes `propertyDefinitionId`
because a property instance's value is per-entity).

Identity is not the cache's concern: the engine accepts an opaque session
tag on writes (extracted by the urql exchange from `data.user.id`) and
wipes + rebinds atomically when the tag changes (silent restart).
