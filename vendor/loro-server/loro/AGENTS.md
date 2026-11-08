# Server Loro compatibility copy

## What it is

Vendored crates.io Loro1.16.2 source for the existing sync server encoding.
The editor stack separately uses registry Loro1.17.1.

## Boundaries

- Preserve upstream source and license; the top manifest uses the adjacent internal crate.
- The internal encoder only drops an unused HasIdSpan import for current shared types.
- Keep this copy outside workspace membership and production policy changes.
- Upgrade only with an explicit wire/corpus compatibility decision.
- Keep consumer behavior tests in sync_server_core, sync_server_sim and sync_sim.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -j4 -p sync_server_core -p sync_server_sim`
- Re-record sync-service and require155zero normalized transcript differences.
