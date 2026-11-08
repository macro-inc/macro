# Lexical conformance

## What it is

Development-only schema-2 fixture interpreter for the pinned upstream oracle.

## Start here

- `src/fixture.rs`: recorder wire schema.
- `src/config.rs`: strict host/provenance and constructor-reference validation.
- `src/replay.rs`: operation ordering, identities and callback tapes.
- `src/replay/bindings.rs`: shared owned handle/key bindings, host ID allocation and per-editor published snapshot pins; return clones before any model or host call.
- `src/replay/selections.rs`: shared mutable-frame selection identities and activation revisions; no model call executes under its lock.
- `src/replay/carets.rs`: shared caret metadata and owned single-consumption cursors; move cursors out before model traversal.
- `src/replay/editors.rs`: per-editor installation and selection slots; prune dead record pointers only after checking all retained snapshots.
- `src/replay/records.rs`: shared record identities for independent callback frames; guards cover owned map operations only.
- `src/api/`: explicit dispatch to model APIs, including caret object identity and metadata.
- `src/api.rs`: shared fixture/WASM call entry point; `build.rs` derives its sorted API index from dispatcher match arms with syn.
- `src/api/context.rs`: host-owned fixture handles, suspended-call selection bookkeeping, publication/discard and explicit state release.
- `src/api/context/callbacks.rs`: weak callback capability with independent mutable dispatcher frames, shared metadata and exact editor/scope checks.
- `src/api/session.rs`: owned editor/pending-update boundary; with_context preserves preconfigured weak callback registrations; calls and flushes suspend without publishing, while failed commits discard model writes and pending handles.
- `src/snapshot.rs`: full observable-state comparison.
- `tests/replay_wasm.rs`: complete embedded corpus in wasm-bindgen-test via `just lexical-replay-wasm`.
- `tests/replay.rs`: one libtest-mimic trial per recorded fixture.
- `tests/flat_diff.rs` and `tests/flat_diff/decoder.ts`: native Rust producer versus the independent Bun/TypeScript consumer of the flat ABI.

## Boundaries

- Read fixtures from `packages/lexical-conformance`; merge recorder updates rather than editing its files here.
- Replay code and mark factories, mark wrapping and tree traversal through their package APIs; direct `exportJSON` returns retain undefined fields while document snapshots omit them.
- Route rich-node constructors and handlers through `lexical_rich_nodes`; replay editor-level command transactions at the recorded enqueue/commit boundary.
- Fix divergences in the owning model crate; never change expected values or skip observable comparisons to turn a failure green.
- Reset write bookkeeping for each replay transaction, including read-only discrete updates.
- Route markdown conversions and normalization through lexical_markdown with decoded standard transformer identifiers; Macro fixtures use the source-ordered Macro transformer lists and list indent 2.
- Table node fixtures and the core table-caret case use concrete table payloads; keep their grid and selection observations strict.
- Apply legacy codeHighlight projection to JSON and code positions only. For fixtures registering Prism, use the named d6_collapse_code_highlight projection described in README.md; replay real code-indentation handlers and never create syntax-highlight nodes.
- Link fixtures use real link transforms and MarkNode descendants; no link ledger entries remain.
- Route multiple editors by recorded identity, keeping commit indices and selection slots per editor.
- Preserve shared allocation generations, internal dirty keys and captured node record identities.
- Marshal own undefined properties separately from JSON snapshots; keep every comparison strict.
- Register Macro classes through the shared source catalog; honor recorded mode, named replacements, namespace entropy and update callbacks.
- Dispatch adapters contain no node or transformer policy.
- Replay composer source functions through macro_document_composers; its development WASM path excludes native trigger_context and workspace-hack.
- Partial recordings restore and validate the complete initial JSON, selection, key layout and next allocation counter before replay; no import transforms or synthetic commits run.
- Decode inline markdown transformer objects with their real regexes and checked callback tapes; nullable import matchers disable import matching.
- Route TabIndentation and Prism registration through rich-node tab/code handlers, preserving critical indent priority over code and rich text; leave tokenization to the view.
- Generated namespace metadata consumes two host draws; explicit namespaces consume one. Macro recordings pass their declared list indentation to markdown conversions.

- Link fixtures use real link transforms and captured raw parent/attribute records; code and mark factories use their package implementations.
- Unmapped APIs fail loudly. Ledger entries require an exact test identity, reason and spec decision; stale entries fail. Live Prism tokenization uses the S4 `d6-highlight` reason; all 452 Macro cases pass without ledger entries. Keep interpreter coverage gaps distinct from native incompatibilities.
- Preserve caret range/point/slice object identities, slice distances, lazy iterator consumption and post-commit snapshot identities. Never synthesize a private cache from computed content.
- Keep nondiscrete updates batched across intervening clock/log observations; only recorded boundaries publish transitions.
- Native loading lives in `source.rs`; the interpreter itself has no filesystem dependency.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_model -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance --test flat_diff -j4` (requires Bun)
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_conformance --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_conformance --all-targets -j4 -- -D warnings`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

- `just lexical-replay`: complete native run plus fingerprinted per-case evidence; failures retain a nonzero exit status.

## Gotchas

- Preserve callback argument/order checks, versioned handles, exact errors and JSON property order.
- Read raw framework fields from the captured record without virtual accessors; element format is numeric alignment and text format is a bitset. NodeState equivalence delegates to the model, including lazy foreign codecs.
- Retain key generations in internal node/key handle values after shared-counter resets; visible keys stay decimal strings.
- Detach replaced selection handles only if the call still owns their activation revision after nested callbacks.
- Retain committed snapshots while their host handles are reachable; release their handles and saved-state pins together, without reusing record identities.
- Bind each Context to one model editor identity across updates, including peers sharing its registry and key allocator.
- Retain Context::callbacks weak capabilities in callback owners; pinned snapshots retain their node registry and callbacks, so strong binding references would form a cycle.
- Defer host version collection until any update borrowing that committed or pending version ends.
- Report pass/fail/ledger totals by source package; ledgered cases do not count toward the 50-fixture core gate.
