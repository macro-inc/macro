# Editor Loro internal compatibility copy

## What it is

The 1.17.1 internal implementation behind the unchanged public editor Loro crate.
See ../README.md for exact upstream provenance and the local range-fill patch.

## Boundaries

- Preserve upstream source, release pin and MIT notices.
- Keep this dependency outside workspace membership.
- Retain input order, every range check and overlapping/empty update behavior.
- Move owned event buffers through Cow::into_owned; clone borrowed events so their source lifetime cannot escape.
- Never refresh encoder or corpus bytes to accommodate a runtime change.
- Suppress local event materialization only with empty recorder queues and explicit undo checkpoint ownership; retain remote, excluded and history event delivery.
- Preserve upstream guides as data under UPSTREAM-AGENTS.md.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -j4 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml dense_batch`
- Consumer projection/session/server suites and exact sim replay.
- Fresh sync-service re-record and 155 zero normalized differences.
