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

## Startup and integrity checks

Normal opens validate schema, scope/version metadata, and pending mutation/optimistic
state without running a full-file `PRAGMA quick_check`. Cached records retain their
checked decoding and runtime corruption handling. This applies to both native
Tauri and browser OPFS storage.

`TursoStorage::check_integrity()` is an explicit, synchronous diagnostic for callers
that need a full scan. Keep it off startup and foreground-read paths; it is not
scheduled automatically in the background. Failures latch the existing storage
health state without deleting records or pending mutations. Recovery/reset remains
an explicit caller decision after closing the storage.

## Network refreshes

Normalized refreshes persist only records whose merged contents changed. The hot
tier is published after the atomic storage write succeeds, so failed writes cannot
make retries incorrectly look unchanged. With no optimistic layers, the changed
record keys also identify visible changes without duplicate before/after snapshots.
Pending layers still use full effective-view comparison and rebasing.

## Browser OPFS writes

The OPFS adapter coalesces each Turso vectored write into batches of at most
1 MiB instead of making one synchronous browser call per WAL frame. Scratch
space is bounded to the same size. Batching never spans separate I/O operations
or delays completion/flushes; offset preflight, partial-write retries, and
first-error propagation retain their existing semantics.

## Projection refreshes

Hydration folds authoritative index mutations in order and writes only final
states that differ from stored state. An updated normalized record does not force
unchanged index facts to be deleted and reinserted. Pending optimistic projections
are still rebased for every affected key, even when authority is unchanged.

## Local filter execution

Local SQL materializes Boolean result sets once, but enumerates a universe only
within the requested profile and partition. Empty predicates do not enumerate
cached documents. Conjunctions with an indexable positive term filter one scoped
candidate set using document-leading fact probes, rather than materializing every
residual posting list. Other negated conjunctions use set difference instead of
first building a full complement. Optimistic facts also use document-leading
primary-key probes rather than repeatedly scanning the materialized shadow set.
These execution choices keep the same predicate, ordering, missing-fact, and
shadow-suppression semantics.

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

## Slow SQL telemetry

The browser WASM driver reports each SQL statement execution **over 200 ms** as
`graphql_cache.slow_query` through the existing page telemetry relay and OTLP
pipeline to Datadog. These events bypass cache sampling/aggregation. Exporting
still requires the existing browser telemetry enablement and exporter config.

Search Datadog logs for `service:web-app "graphql_cache.slow_query"`:

- `cache.duration_ms`: binding, stepping/OPFS I/O, row collection, and cleanup;
  excludes statement preparation and time queued in the worker.
- `db.query.fingerprint`: 16-digit lowercase FNV-1a hash of the exact unexpanded
  SQL template, allowing repeated executions to be grouped without exporting SQL.
- `cache.outcome`: `success` or `error`; slow failures are reported too.
- `cache.slow_query_threshold_ms`: `200`.

Parameters, results, raw SQL, and user identity are not exported. Logging uses
an anonymous span context. A throwing JS telemetry callback cannot change query
results. Native hosts are unchanged unless they install their own telemetry sink.

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
