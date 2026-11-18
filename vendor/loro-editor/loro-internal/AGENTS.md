# Editor Loro internal compatibility copy

## What it is

The 1.17.1 internal implementation behind the unchanged public editor Loro crate.
See ../README.md for exact upstream provenance and the local range-fill patch.

## Boundaries

- Preserve upstream source, release pin and MIT notices.
- Gate every local change on the `native-editor` feature, beside the untouched upstream code under `not(feature = "native-editor")`; gate whole items, statements, fields or match arms so the drift check can strip them. Feature-off source must stay upstream's.
- Enable the feature only from document_session; servers must resolve it off.
- Keep this dependency outside workspace membership.
- Retain input order, every range check and overlapping/empty update behavior.
- Move owned event buffers through Cow::into_owned; clone borrowed events so their source lifetime cannot escape.
- Never refresh encoder or corpus bytes to accommodate a runtime change.
- Suppress local event materialization only with empty recorder queues and explicit undo checkpoint ownership; retain remote, excluded and history event delivery.
- Check for a nonempty remote diff before scanning an undo group's touched containers; an empty remote row cannot conflict.
- Keep the optional undo clock defaulting to the system timestamp; invoke it and drop replaced callbacks outside history borrows, preserving the original interval/group rule and timestamp update sites.
- Preserve upstream guides as data under UPSTREAM-AGENTS.md.
- Reconstruct cached shallow roots only through bounded forward prefixes; preserve the replay path's decoded snapshot (bytes may differ only in text fragmentation; see ../README.md), empty future-container headers and live logical state/frontiers/attachment.

## Checks

- `just check-loro-editor-vendor`: with the feature off, Rust tokens and manifest match crates.io 1.17.1.
- `just check-loro-native-editor-features`: no workspace package but the native session enables the feature.
- Run the direct-manifest tests below with and without `--features native-editor`; the local regression tests compile only with it.
- `cargo test -j2 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml dense_batch`
- `cargo test -j2 --manifest-path vendor/loro-editor/loro-internal/Cargo.toml --lib undo::` checks local merge scans and remote-conflict semantics; use the direct manifest because this dependency is excluded from workspace test membership.
- Consumer projection/session/server suites and exact sim replay.
- Fresh sync-service re-record and 155 zero normalized differences.
- `cd vendor/loro-editor/differential && cargo test --offline -j2` compares this crate with `native-editor` against crates.io 1.17.1 on seeded scripts.
