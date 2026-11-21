# Editor Loro internal source

This is the crates.io loro-internal 1.17.1 distribution from upstream revision
`ef83c083f19aea0d590a46db2d541b3a5daf1339`. Public Loro and the TS peer stay 1.17.1;
this changes neither the release pin nor the encoder/format.

Registry archive SHA-256: `7e533c1688430aa4fcdd933f00861e331c169a4158ee6d27d054e0558892d447`.
The MIT license is retained from that exact upstream revision. Upstream agent
guidance is retained as UPSTREAM-AGENTS.md. Optional author metadata, registry
cache markers, standalone lockfiles and the redundant unnormalized manifest are
omitted. Trailing whitespace is trimmed in Encoding.md. The exact upstream dev-utils helper is restored as a development-only
dependency for standalone tracker tests; it is absent from production dependency trees.

## The `native-editor` feature

Every local runtime change below compiles only with loro-internal's
`native-editor` feature, which is off by default. Off, this crate compiles from
exactly the crates.io 1.17.1 Rust source and manifest (bar the declared manifest
keys): each change is a whole item, statement, field or match arm gated on the
feature beside the untouched upstream code it replaces, gated on its negation.
`just check-loro-editor-vendor` strips the feature-off source and compares its
tokens with the downloaded release.

Only document_session enables the feature (through lexical_loro's optional
`native-editor` feature for event-suppressed commits), so the native editor
session, its WASM and FFI builds and sync_sim run these changes. Servers that
link this crate through the workspace patch run upstream behaviour;
`just check-loro-native-editor-features` fails if any other workspace package's
own dependency graph enables it, or if any nix deploy build (services and
Lambdas) resolves it on with the exact cargo command it runs; deploy builds must
select their package, since `cargo build --bin X` alone resolves the workspace. Cargo unifies features per build, so a build
that links document_session beside server crates (sync_sim, a workspace-wide
`cargo test`) runs the server side with these changes too; that is test-only. The shallow-export fast path duplicates
upstream's forward-replay block under the feature instead of editing it, so the
feature-off branch stays verbatim.

The existing required Rust `check` job runs both guards as failing steps when
vendor, manifests, guard tools or deployment-selection inputs change. YAML
consumer discovery is structural, so YAML inputs are included regardless of
filename. Guarded changes get a 30-minute job budget; other changes retain 20.
`just test-loro-servers-upstream` and `just test-loro-editor-differential` remain
local commands: they add server/worker builds and differential suites beyond
the two required guards and the existing job's budget. No standalone or nightly
workflow is added. Local timings do not establish CI performance; the guarded
path must execute successfully on the published CI head.

Deploy selections without an explicit target are checked with `--target all`;
explicit targets remain unchanged. Non-registry `cargo install --path` and
`--git` commands are rejected. The deploy parser covers a bounded tracked
literal grammar: Docker ARG defaults are currently file-wide, and stage/order
overrides and broader dynamic or imported consumer discovery are not proven.
The independent package pass still checks every server package on all targets;
the deploy pass is not a general proof of Docker, shell or TypeScript semantics.

## Local changes

Local runtime change: assign each dense text-tracker update range through a
checked slice fill instead of repeated checked SmallVec indexing. LeafIndex is
Copy; input order, bounds/debug checks and resulting leaf assignment remain the
same, including overlapping and empty ranges. Encoder/serializer code and corpus
expectations are untouched.

Validate ordered range updates against the existing sequential update algorithm,
consumer tests, exact replay, and a fresh Worker re-record with 155 zero normalized
differences. Keep this path dependency outside workspace membership.

Local event ownership change: move already-owned InternalDocDiff buffers into
the recorder instead of cloning their MapDelta maps a second time. Borrowed
events still become independent owned copies; ordering, undo, remote consumers
and encoder bytes retain their existing semantics. Validate the owned/borrowed
event unit tests and projection/session differential suites.

Eligible editor-owned local commits can suspend event recording at the final
commit boundary. Their undo manager checkpoints the new local op span and its
container ids, preserving remote group conflicts without constructing duplicate
document diffs. Pending event queues, paused/excluded edits, fixups, imports and
undo/redo retain ordinary event delivery. Suppression is opt-in and recording
resumes even on native unwinding. The next event keeps upstream's start
version: a suspended commit that writes a change moves it to the committed
version, as upstream's converted event would; an empty projection commit keeps
the unreported start from before the suspension.

Local undo patch (`src/undo.rs`): skip the group-disjoint container scan when
the remote diff map is empty; retain the same merge and remote-conflict rules.
Upstream rationale: an empty remote row cannot conflict, so local undo pushes need no scan of the group.

Local shallow-export optimization: reconstruct an eligible requested root from
its cached shallow state plus a bounded retained prefix, avoiding reverse
checkout of a large tail. Keep the existing frontier, retention/redaction,
latest-state overlay and encoder; reproduce reverse checkout's empty future
container headers. Reject oversized cached state or prefixes before copying,
and retain ordinary checkout for ineligible or unreadable seeds. The decoded
snapshot equals reverse checkout's, including rich/deleted containers, multiple
peers and detached documents; the bytes may differ in text fragmentation: when
a tail insert split prefix text, reverse checkout encodes the root text in
fragments and the replay in one span. Validate retained snapshot/WAL controls
through a production-mode decoder as well as the library tests.

Consumers of these shallow exports rely on decoded equality only. The one
native producer is doc_sync_core's local snapshot save (`core/imports.rs`
`export_shallow_snapshot(confirmed_base)`, through document_session's SyncDoc).
Its bytes travel as `StorageOp::SnapshotSave` (document_session_wasm and the
FFI types copy them opaquely) into the web host's IndexedDB snapshot row,
keyed by document id (`packages/collaboration/src/session/storage.ts`), and are
only imported again on load. WAL adoption's byte comparison covers update rows,
not snapshots. Native uploads to the sync service are update exports and full
snapshots, never shallow ones, and servers compact with this feature off. No
consumer hashes, deduplicates or byte-compares a shallow snapshot. A new one
must compare decoded state, or this path must change.

`differential/` builds this crate with `native-editor` beside crates.io 1.17.1
and compares seeded scripts step by step (values, versions, undo, events and
export bytes in every mode, shallow exports by decoded state); see its
AGENTS.md.

The editor undo manager accepts an optional millisecond time source for hosts
that supply their own clock. An unset source retains the upstream system
timestamp. The source is sampled at the existing checkpoint timestamp site;
only a non-merged checkpoint advances the previous timestamp. Group boundaries,
clear, navigation, peer changes and stack eviction retain their upstream rules.
Callbacks run without a history borrow, and replacing a callback releases the
previous capture outside both the history borrow and lock. The document session
uses its host wall clock and the application merge interval; the server copy and
wire formats are unchanged.

The upstream `loro-internal/benches/automerge-paper.json.gz` benchmark input is
omitted: no build or test here reads it, and its recorded edit trace carries
contributor email addresses. Restore it from the upstream release to run those
benches or examples.
