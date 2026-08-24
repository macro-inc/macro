# graphql-cache

Normalized GraphQL cache with disk-backed persistence for urql. Design doc:
[`apps/web/docs/graphql-normalized-cache-plan.md`](../../apps/web/docs/graphql-normalized-cache-plan.md).

## Crates

| Crate | Purpose |
|---|---|
| `cache-core` | Pure engine: normalize/denormalize, LRU hot tier, dependency index, durable ordered optimistic-mutation queue, async `Storage` trait |
| `cache-turso` | `Storage` over Turso core — browser WASM and Tauri native hosts |
| `turso-opfs` | Browser OPFS `IO`/`File` adapter for the dedicated Turso engine worker |
| `cache-wasm` | wasm-bindgen shell combining the engine, Turso storage, and OPFS adapter for browser worker glue (`apps/web/src/lib/graphql-cache/`) |

The Tauri host lives in the tauri workspace (it needs the patched tauri fork
pinned there): `apps/web/tauri/graphql_cache_plugin`, path-depending on
`cache-core`/`cache-turso`. Test it from `apps/web/tauri` with
`cargo test -p graphql_cache_plugin` (on NixOS use the `tauri-linux` dev shell —
Tauri's Linux desktop stack needs its WebKitGTK/DBus system libraries).

## Tests

Run from the repository root:

```sh
cargo test -p cache-core -p cache-turso -p turso-opfs
cargo check --target wasm32-unknown-unknown -p cache-turso -p turso-opfs -p cache-wasm --all-targets
wasm-pack test --headless --chrome crates/client/cache-turso
wasm-pack test --headless --chrome crates/client/turso-opfs
```

NixOS note: wasm-pack downloads a dynamically-linked chromedriver that won't
run. Work around by resolving the cached runner whose reported version matches
the workspace's `wasm-bindgen`, then invoke it with a Nix chromedriver:

```sh
wasm_bindgen_version=$(
  cargo tree -p cache-turso --target wasm32-unknown-unknown -i wasm-bindgen --prefix none |
    sed -n 's/^wasm-bindgen v//p' |
    head -n 1
)
runner=
for candidate in "$(command -v wasm-bindgen-test-runner || true)" \
  "$HOME"/.cache/.wasm-pack/wasm-bindgen-*/wasm-bindgen-test-runner; do
  [ -x "$candidate" ] || continue
  [ "$("$candidate" --version)" = "wasm-bindgen-test-runner $wasm_bindgen_version" ] || continue
  runner=$candidate
  break
done
test -x "$runner" || {
  echo "no wasm-bindgen-test-runner matching $wasm_bindgen_version" >&2
  exit 1
}

chromedriver=$(command -v chromedriver || true)
if [ -z "$chromedriver" ]; then
  for candidate in /nix/store/*chromedriver*/bin/chromedriver \
    /nix/store/*chromedriver*/bin/undetected-chromedriver; do
    [ -x "$candidate" ] || continue
    chromedriver=$candidate
    break
  done
fi
test -x "$chromedriver" || {
  echo 'no Nix chromedriver found' >&2
  exit 1
}

CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" \
CHROMEDRIVER="$chromedriver" \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown -p cache-turso

CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" \
CHROMEDRIVER="$chromedriver" \
WASM_BINDGEN_TEST_ONLY_WEB=1 cargo test --target wasm32-unknown-unknown -p turso-opfs --lib
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

Optimistic GraphQL mutations are persisted with their replay request before
becoming visible. The exchange claims and applies them strictly in enqueue
order; a configurable callback decides whether an error remains queued or
permanently rolls back.
