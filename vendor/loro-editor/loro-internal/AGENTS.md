# Editor Loro internal compatibility copy

## What it is

The 1.17.1 internal implementation behind the unchanged public editor Loro crate.
See ../README.md for exact upstream provenance and the local range-fill patch.

## Boundaries

- Preserve upstream source, release pin and MIT notices.
- Keep this dependency outside workspace membership.
- Resolve ordinary child membership without computing its rank; retain value/active-leaf checks and mergeable marker validation.
- Retain input order, every range check and overlapping/empty update behavior.
- Move owned event buffers through Cow::into_owned; clone borrowed events so their source lifetime cannot escape.
- Never refresh encoder or corpus bytes to accommodate a runtime change.
- Suppress local event materialization only with empty recorder queues and explicit undo checkpoint ownership; retain remote, excluded and history event delivery.
- Check for a nonempty remote diff before scanning an undo group's touched containers; an empty remote row cannot conflict.
- Preserve upstream guides as data under UPSTREAM-AGENTS.md.

- Share the full-replay operation index only within one immutable diff; preserve causal/sliced visitor parity and reuse DAG contexts instead of retaining one mutable VV per change.
- Reconstruct cached shallow roots only through bounded forward prefixes; preserve exact replay-path snapshot bytes, empty future-container headers and live logical state/frontiers/attachment.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -j2 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml --lib replay_cache_test`
- `TMPDIR=/home/wolf/tmp cargo test -j2 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml dense_batch`
- `TMPDIR=/home/wolf/tmp cargo test -j2 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml --lib undo::` checks local merge scans and remote-conflict semantics; use the direct manifest because this dependency is excluded from workspace test membership.
- `TMPDIR=/home/wolf/tmp cargo test -j2 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml logical_child_membership` checks direct-value membership, import/checkout, list size transitions, movable revival and mergeable/tree reachability.
- Consumer projection/session/server suites and exact sim replay.
- Fresh sync-service re-record and 155 zero normalized differences.
