# Server Loro compatibility copy

## What it is

Vendored crates.io Loro 1.16.2 source for the existing sync server encoding.
The editor stack separately uses Loro 1.17.1 and its local internal copy.

## Boundaries

- Preserve upstream source and license; the top manifest uses the adjacent internal crate.
- The internal encoder drops an unused HasIdSpan import for current shared types.
- Dense tracker ranges use equivalent checked slice fill; retain ordered/empty/overlap parity.
- Keep this copy outside workspace membership and production policy changes.
- Upgrade only with an explicit wire/corpus compatibility decision.
- Keep consumer behavior tests in sync_server_core, sync_server_sim and sync_sim.

- Share the full-replay operation index only within one immutable diff; preserve causal/sliced visitor parity and reuse DAG contexts instead of retaining one mutable VV per change.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -j2 --manifest-path vendor/loro-server/loro-internal/Cargo.toml --lib replay_cache_test`

- `TMPDIR=/home/wolf/tmp cargo test -j4 --manifest-path vendor/loro-server/loro-internal/Cargo.toml dense_batch`

- `TMPDIR=/home/wolf/tmp cargo test -j4 -p sync_server_core -p sync_server_sim`
- Re-record sync-service and require 155 zero normalized transcript differences.
