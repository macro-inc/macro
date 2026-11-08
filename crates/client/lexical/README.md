# Portable Lexical model

This directory owns the Rust port of Lexical v0.45.0. Model crates are sans-I/O:
UTF-16 offsets, explicit clocks and peer IDs, and no browser or server runtime.
Loro projection lives beside the editor core; session composition belongs in
`crates/client/document_session`, not inside the model.

`lexical_model` provides the value types, typed node registry, immutable snapshots,
NodeState and copy-on-write transactions. Its base kinds preserve declared parent
projections and dispatch hooks without a browser runtime. Tree edits live on the
transaction; user payloads never own links or framework fields. Commits run ordered
transforms, text normalization, detached-node collection and mutation reporting. View-attached
editors synchronize text caches after mutation reporting. JSON import/export preserves
unknown NodeState and upstream property order; `to_js_json_string` provides JavaScript
number formatting and integer-key ordering. Selection values, detached slots, formatting,
insertion and deletion share those transactions. Movement accepts host-resolved points;
the optional `model-segmentation` feature supplies text-only Unicode movement. Directional
carets and eager cursors support mutation during traversal. Commands dispatch through
priority-indexed plugins; extension state stages with transactions, and post-commit hooks
share bounded follow-up rounds. History supplies snapshot undo/redo and independent merge
classification. EditorCore consumes explicit inputs and returns commits, structural diffs
and host effects, including DOM-first text suppression. Diffs encode the versioned
11-opcode word/UTF-8 ABI without wire derives on model inputs.

`lexical_loro` incrementally projects editor commits into Loro 1.17.1 and native
events back into raw editor changes, with schema-compatible container inference,
durable-id matching, UTF-16 awareness cursors and consistency checks. Application
sync policy and session orchestration remain outside the projection.

`lexical_conformance` interprets the recorder's schema-2 fixtures against this
model. It checks call results, versioned identities, strict core key allocation,
commits and final snapshots. Its exact expected-failure ledger keeps later work
packages visible; ledgered trials do not count as passing fixtures. Run
`cargo test -p lexical_conformance --test replay -- --report-coverage` for
per-package pass/fail/ledger counts and blocking APIs. The native `flat_diff` integration
test runs Bun against an independent TypeScript decoder for every opcode and malformed
buffers; it does not require a wasm runtime.

`lexical_workspace_tests` verifies the patched regex dependency and Loro snapshot
compatibility alongside the model packages. `lexical_rich_nodes` adds rich/plain
text command functions, heading/quote/hashtag/overflow nodes, text entities and
selection plugins, list nodes and structural list editing, link/autolink nodes,
shared UTF-16 matchers, the pinned linkify-it port, and table nodes, span maps,
restructuring, selection hooks and model interaction handlers. Table handlers take
host layout facts and return observer effects. Conformance replay calls
these package APIs. Markdown, HTML and projection packages belong here too.

Dependencies come from the root workspace table. The existing
`crates/client/*` hakari prefix exclusion also covers these nested crates; do not
add workspace-hack dependencies. The root cargo-shear exceptions cover the
reserved dependencies only; remove each as its first consumer lands. Give every new crate its own `AGENTS.md` and
`CLAUDE.md` symlink, and check its wasm dependency tree.

Loro is pinned to **1.17.1** in Rust, the Bun catalog and the sync-service npm
package. Version 1.16.3 included a core cross-document container fix, so aligning
on 1.16.2 would discard that fix. Update all three lockfiles together. The
1.17.1 source retains the clock/randomness controls required by sessions:
`set_record_timestamp(false)`, explicit `CommitOptions::timestamp`,
`set_peer_id` immediately after new/fork, no detached editing or update timeout,
and undo merge interval zero. Presence must use an injected clock, not the
convenience real-time awareness wrapper.

Verified source locations for Loro 1.17.1: transaction timestamps in
`oplog.rs:1376`, random peers in `state.rs:498,528,572` and `loro.rs:295`,
detached editing in `loro.rs:243,2932,2957`, optional diff clocks in
`diff/diff_impl.rs:127`, and undo time/group merging in `undo.rs:651`.
Presence retains postcard `EncodedState` (`awareness.rs:379`) and receiver-side
expiry (`awareness.rs:680`); inject the clock when extracting that store.

For legacy JavaScript regexes, use regress's `find_from_ucs2` over UTF-16 code
units. Its `find_from_utf16` API decodes surrogate pairs regardless of flags;
that would skip individual surrogates which JavaScript without `u` can match.
The conformance test covers this distinction over the complete BMP input.

The rich-node package includes stored code/highlight preservation, plain code editing, inline marks, selection/tree/text/offset helpers and model clipboard strings. Its replayer executes all admitted code, mark and utility fixtures without package ledger entries. The recorder index still distinguishes unavailable B-only cases and view assertions; `lexical_html` supplies export-only DOM construction and linkedom serialization; rich-node exporters and clipboard HTML are behind the rich package’s `html` feature.

`lexical_markdown` provides portable markdown import/export, ordered transformer
contracts, standard block/inline groups and sans-IO insertion/Enter shortcuts. The Tier A interpreter routes markdown
conversion through this engine; the regex corpus is checked against pinned V8.
