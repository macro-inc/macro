# graphql-cache

Normalized GraphQL cache with disk-backed persistence for urql. Design doc:
[`js/app/docs/graphql-normalized-cache-plan.md`](../../js/app/docs/graphql-normalized-cache-plan.md).

## Crates

| Crate | Purpose |
|---|---|
| `cache-core` | Pure engine: schema-metadata codegen (build.rs from `rust/cloud-storage/schema.graphql` + `key_config.toml`), normalize/denormalize, LRU hot tier, dependency index, async `Storage` trait |
| `cache-sqlite` | `Storage` over SQLite — Tauri native host |
| `cache-idb` | `Storage` over IndexedDB via the `idb` crate — browser wasm host (wasm32-only; empty shell elsewhere) |

Planned (Phase 3): `cache-wasm` (wasm-bindgen shell + worker RPC), `cache-tauri`
(Tauri plugin) — see the design doc.

## Tests

```sh
cargo test                 # native: cache-core + cache-sqlite
cargo check --target wasm32-unknown-unknown -p cache-idb --all-targets
wasm-pack test --headless --chrome cache-idb   # browser tests for the IDB backend
```

NixOS note: wasm-pack downloads a dynamically-linked chromedriver that won't
run. Work around by invoking the runner directly with a nix chromedriver:

```sh
cd cache-idb
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=~/.cache/.wasm-pack/wasm-bindgen-*/wasm-bindgen-test-runner \
CHROMEDRIVER=$(command -v chromedriver || echo /nix/store/*undetected-chromedriver*/bin/undetected-chromedriver) \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown
```

## Key policy

`cache-core/key_config.toml` decides which schema types are normalized
entities vs embedded values. **The build fails when the schema and the key
config drift** — adding a type to `schema.graphql` requires a caching
decision here.
