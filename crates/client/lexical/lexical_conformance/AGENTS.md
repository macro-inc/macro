# Lexical conformance

## What it is

Development-only schema-2 fixture interpreter for the pinned upstream oracle.

## Start here

- `src/fixture.rs`: recorder wire schema.
- `src/config.rs`: strict host/provenance and constructor-reference validation.
- `src/replay.rs`: operation ordering, identities and callback tapes.
- `src/replay/bindings.rs`: shared owned handle/key bindings, host ID allocation and published snapshot pins; return clones before any model or host call.
- `src/replay/selections.rs`: shared selection objects with transaction-local slot caches and activation revisions; no model call executes under its lock.
- `src/replay/carets.rs`: shared caret metadata and owned single-consumption cursors; move cursors out before model traversal.
- `src/replay/records.rs`: shared record identities for independent callback frames; guards cover owned map operations only.
- `src/api/`: explicit dispatch to model APIs, including caret object identity and metadata.
- `src/api.rs`: shared fixture/WASM call entry point; `build.rs` derives its sorted API index from dispatcher match arms with syn.
- `src/api/context.rs`: host-owned fixture handles, suspended-call selection bookkeeping, publication/discard and explicit state release.
- `src/api/context/callbacks.rs`: weak callback capability with independent mutable dispatcher frames and owned scoped read peers; exact update provenance authorizes reads through publication, while mutable dispatch stops before it. The read scope shares owned value identities, keeps peer slot metadata local and grants no source transaction access.
- `src/api/session.rs`: owned editor/pending-update boundary and published host version; with_context preserves preconfigured weak callback registrations; calls and flushes suspend without publishing, while failed commits discard model writes and pending handles.
- `src/snapshot.rs`: full observable-state comparison.
- `tests/replay_wasm.rs`: complete embedded corpus in wasm-bindgen-test via `just lexical-replay-wasm`.
- `tests/replay.rs`: one libtest-mimic trial per recorded fixture.
- `tests/flat_diff.rs` and `tests/flat_diff/decoder.ts`: native Rust producer versus the independent Bun/TypeScript consumer of the flat ABI.

## Boundaries

- Read fixtures from `packages/lexical-conformance`; merge recorder updates rather than editing its files here.
- Replay code and mark factories, mark wrapping and tree traversal through their package APIs; direct `exportJSON` returns retain undefined fields while document snapshots omit them.
- Route rich-node constructors and handlers through `lexical_rich_nodes`; replay editor-level command transactions at the recorded enqueue/commit boundary.
- Fix model divergences in `lexical_model` or `lexical_rich_nodes`; never change expected values or skip observable comparisons to turn a failure green.
- Reset write bookkeeping for each replay transaction, including read-only discrete updates.
- Route markdown conversions and normalization through lexical_markdown with decoded standard transformer identifiers; the expanded corpus reports unsupported or divergent markdown cases explicitly.
- Apply legacy codeHighlight projection to JSON and code positions only. For fixtures registering Prism, use the named d6_collapse_code_highlight projection described in README.md; replay real code-indentation handlers and never create syntax-highlight nodes.
- Table node fixtures use concrete table payloads; expanded-corpus gaps remain explicit.
- Link fixtures use real link transforms and MarkNode descendants; no link ledger entries remain.
- Unmapped APIs fail loudly. Ledger entries require an exact test identity, reason and spec decision; stale entries fail.
- Partial recordings restore and validate the complete initial JSON, selection, key layout and next allocation counter before replay; no import transforms or synthetic commits run.
- Decode inline markdown transformer objects with their real regexes and checked callback tapes; nullable import matchers disable import matching.
- Route TabIndentation and Prism registration through rich-node tab/code handlers, preserving critical indent priority over code and rich text; leave tokenization to the view.
- Generated namespace metadata consumes two host draws; explicit namespaces consume one. Macro recordings pass their declared list indentation to markdown conversions.

- Link fixtures use real link transforms and captured raw parent/attribute records; code and mark factories use their package implementations.
- Unmapped APIs fail loudly. Ledger entries require an exact test identity, reason and spec decision; stale entries fail. Macro policy and live Prism tokenization use the S4 `macro-patch` and `d6-highlight` reasons. Keep interpreter coverage gaps distinct from native incompatibilities.
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
- Keep collected raw captures by version and generation-aware key until version release; historical snapshots take precedence, and graph lookup never consults retired records. Drop replaced/released record owners outside binding locks.
- Read raw framework fields in src/api/properties/node.rs from the captured record without virtual accessors; element format is numeric alignment and text format is a bitset. NodeState equivalence delegates to the model, including lazy foreign codecs.
- Retain key generations in internal node/key handle values after shared-counter resets; visible keys stay decimal strings.
- Detach replaced selection handles only if the call still owns their activation revision after nested callbacks.
- Retain committed snapshots while their host handles are reachable; release their handles and saved-state pins together, without reusing record identities.
- Bind each Context to one model editor identity across updates, including peers sharing its registry and key allocator.
- Retain Context::callbacks weak capabilities in callback owners; pinned snapshots retain their node registry and callbacks, so strong binding references would form a cycle.
- Defer host version collection until any update borrowing that committed or pending version ends.
- Report pass/fail/ledger totals by source package; ledgered cases do not count toward the 50-fixture core gate.

Session runtime transform registration operates on the owned editor even while its
update is suspended. CallbackContext::node uses the same encoded identity store as
indexed dispatch; it validates the exact active editor and pending update first.

Session application listeners reuse the model priority pipeline; command dispatch
requires an explicit pending update. JS identity and opaque values belong to the
development WASM adapter, not the portable shared API value encoding.

$getNodeByKey follows the upstream Map lookup for absent or non-key arguments:
return null instead of failing raw-key binding resolution. The WASM host retains
JSON null distinctly from the fixture encoding for undefined.

Session::finish_noop closes an unchanged suspended update without a model commit,
retaining detached API value objects. It must reject selection, composition,
extension, event, reconciliation and queued-work effects; tags alone may close.

Session::commit_prepared encodes artifacts against the upcoming host version before
model publication. Preparation errors invalidate pending handles and retain the
last committed host version; already published preceding transitions are retained.

Node indexed dispatch uses model tree queries and predicates for all node kinds.
Keep element alignment/style/text-format fields distinct from text format/detail,
and preserve null versus undefined when decoding getFormatFlags alignment.

Preserve selection direction memos in host captures, detached-handle transfers and rollback values; clear them only for explicit upstream selection clones and active update clones.

Route indexed text splicing, JSON updates, copy predicates and element creation through the model; retain D-6 surrogate and D-7 unsigned-offset checks at the bridge.

Context/Session call_native uses the shared API index and model-derived hook names; accept only indexed node hooks and preserve the exact mutable callback frame. Native-super bypasses one outer foreign dispatch, never a whole native operation. Pure indexed read dispatch and lifecycle construction scopes remain separate host work.

Native-super currently selects the nearest registered native ancestor. Explicit older-prototype targeting (for example a TextNode base method on a TabNode) is still required with the native facade/overlay; do not count this primitive as full native-class hosting acceptance.

Key RecordIdentities by immutable model tokens, not allocation addresses; resolve owner versions by matching the source token before encoding handles. Token retention must not pin records or force COW, including native-projection read peers.

Keep conformance.createForeignNode an internal development constructor in the shared indexed dispatcher; return through the normal captured-node identity encoder and honor read-mode guards before allocation.

Preserve original encoded indexed-hook arguments in exact node/hook scopes before native normalization; consume once at JS dispatch and restore guards on every exit. Native-super installs no original-argument frame, so nested virtual calls receive their actual model arguments. Retain owned JSON only, with no transaction borrow or lock across host calls.

Resolve hosted node return values with CallbackContext::returned_node in the exact active update. Require a known captured node handle whose key still exists; reject raw keys, non-node values and stale callback capabilities.

CallbackContext::selection encodes an existing active or detached transaction slot in the shared selection identity store without cloning or activating it. Preserve the exact callback update capability and reuse prior slot handles.

Synchronize selection slot bindings by model object tokens before/after dispatch and when encoding callback selections. Reuse tokens when hydrating host values, including read frames and explicit reactivation; never infer replacement identity solely from the resettable selection_replacements counter or snapshot old values after callbacks.

Share selection IDs, tokens and owned values across dispatch frames, but keep slot caches and activation revisions local to each transaction frame. Resolve handles through the invoking transaction token and lazily hydrate saved detached values; never decode a peer selection using another frame's slot index. Mutable nested callbacks share their exact frame; owned read peers require a separate frame.

Use CallbackContext::with_read_scope for a whole pure callback, keeping one guarded owned peer across indexed calls. Reject command, tag and scheduling effects at the dispatcher boundary. Save only newly allocated, locally created selection values at scope exit, including error exits; never overwrite inherited captured values. Read peers never hydrate saved tokens absent from their capture; mutable frames may hydrate them after the read ends. Inherited selection object writes and absent cross-scope values currently reject until ancestor synchronization is implemented; full JS pure-hook hosting remains unfinished.

Route lexical.$parseSerializedNode through Transaction::import_node and the normal captured-node encoder; recursive children and virtual append belong to the model import algorithm, never a second shim tree builder.
