# WP-07 Tier C: upstream text/paragraph

Install from the repository root, then run inside the package to use its pinned
Vitest version:

```sh
bun install --cwd packages/lexical-conformance --frozen-lockfile
\cd packages/lexical-conformance
STEPS=10000 bunx vitest run --config diff/vitest.config.mts
```

The fixed seeds are 73129, 19088743 and 1592639710. `STEPS` counts generated
commands per seed; `DIFF_SEED` and `DIFF_PATH` replay one run. Every generated
command executes against the current upstream tree. A failure stops at the first
mismatch, delta-shrinks the tape and writes its seed, commands and snapshots to
`../fixtures/fuzz/`. Every saved tape is replayed on subsequent invocations.

The config builds optimized Node and web WASM with cargo, wasm-bindgen and
wasm-opt, requiring the wasm32 target and those tools on PATH. Builds are locked
and cached within this worktree. The setup file assigns the Chrome user agent
after jsdom creation, avoiding the removed ResourceLoader API while preserving
the oracle environment before test modules load. The loader frees each handle after a run.
Upstream source is fetched and checksum-verified from `upstream.lock` into a
separate disposable directory, without touching the recorder's source checkout.

U uses the pinned production source with S1 D-11 error-mode caret validation retained, a headless editor for transactions and a
second attached jsdom editor for view events. Hydration notifications are
suppressed outside the command, then real input, compositionend and
selectionchange events run upstream DOM-reading code. A pre-reconciliation
observer copies node identities before view caches are written. Dirty sets come
from the actual update-listener arguments, including reconciliation dirtiness.
This observer changes no model state. Hydration reconciles against the previous
attached tree, so existing DOM nodes refresh typing caches while newly created
nodes retain their defaults. Empty roots are synchronized with public root
setters because upstream rejects empty `setEditorState` calls. Copying the
attached state back to the headless editor clears only its DOM-owned root text
cache, which headless updates cannot maintain; state installation also drops
carried DOM update tags. R keeps a peer editor sharing its registry and key
allocator and mirrors these setup operations outside its captured command.
Fake timers provide a deterministic clock and drain all updates.
Geometry stubs return empty rectangles; no layout movement is generated in v0.

R uses `lexical_conformance_wasm` directly, never the shim. JSON, selection,
root text, persistent key bijection, commit presence, dirty sets including
intent, mutations, normalized keys and tags are compared after every command.
No document fields are ignored. Transient identities also enter the bijection;
destroyed and normalized-away identities retire, so matching key reuse on both
sides still fails. Each long seed must execute every v0 command in at least 0.5%
of its steps. The Node and web binding test initializes both optimized artifacts,
checks independent handles and frees them in a finally block.

S1 D-6/Q6 requires rejecting edits that split surrogate pairs. Generated edits
therefore use scalar boundaries, including astral and ZWJ text; explicit selection
cases still cover interior UTF-16 offsets. Saved invalid-edit tapes have an
explicit `policy` record and verify atomic rejection independently of upstream's
lone-surrogate acceptance. This is a documented S1 boundary, not a comparator
normalization.

`patches/cascade-count.patch` is S4's prescribed `divergence-cascade-guard`:
it disables only the upstream long-run cascade guard in this disposable oracle.
S1 D-11 also keeps the error-mode `$getTextNodeOffset` guard enabled in this
release oracle, matching Rust's always-on guard. The Vite transform changes only
that call from `devInvariant` to `invariant` and checks its pinned source shape.
Its numeric offset is rendered with Rust's typed error spelling; the full state,
selection and identities still compare exactly. The oracle validates that its
failed-update recovery listener contains empty arrays before representing it as
no commit, matching Rust's atomic rejection. Nonempty recovery data fails. Other console
errors fail the run. The recorder's hooks and fixtures are separate.

This is WP-07 v0: raw transactions for text, paragraphs, line breaks, tabs,
formatting and view inputs. EditorCore/session encoding (WP-14), rich nodes,
markdown, history, command-bus handlers and foreign JS nodes (WP-54) are outside
this package. Their future full S4 surface is not claimed by this harness.

S1 D-11 requires `$getTextNodeOffset` bounds errors in release fuzzing. The
config retains precisely that invariant; the oracle maps its diagnostic to the
Rust boundary error while comparing outcomes and snapshots normally. It does
not suppress mismatches or disable validation.

For an identical paired caret bounds error, S1 D-13 permits upstream's empty
recovery publication versus Rust's absent commit. The comparator accepts this
only when every upstream commit array is empty and Rust's JSON, selection, text
and live keys equal the previous snapshot. Nonempty recovery metadata fails.

The build postprocesses each optimized artifact with the native
`instrument_exports` example. Forwarding wrappers count actual export entries,
including imported function exports, raw allocator calls and trapping frees;
internal model calls retain their original indices. Bindgen throw imports receive
internal string wrappers so trapping-receiver error messages count too. Do not optimize after this step.
`debug.test.ts` verifies the resulting Node/web counters and editor-facade
lifetimes. Reset starts a new crossing interval; observations count their own
entry. Byte accounting derives fixed inputs and string ABI positions from the Rust
exports, verifies optimized signatures, and rejects unknown export policies.
Strings count UTF-16 units times two, including copied inputs of trapping calls;
optional absent strings ignore stale bindgen lengths. Numeric values use their
facade widths; returned object keys/values count recursively, with f64 JS numbers.
Container, allocator, pointer/length and generated control metadata carry no
payload. Reserved raw counter-helper arguments are measurement adjustments.
The existing raw facades still do not implement the full WP-54 EditorHandle
contract.


`host.test.ts` also exercises the native indexed `EditorHandle`: its API IDs come
from the Tier A dispatch table, and each call uses `{args: [...], this?: handle}`.
Updates suspend between calls; flush does not publish, commit returns the existing
flat diff plus changed base-record/mutation/selection metadata in a development
postcard envelope, and discard invalidates unpublished handles. Packet TypeScript
types are generated from Rust with `cargo run -p lexical_conformance_wasm --example
export_host_types -j4` (add `-- --check` for freshness). The decoder rejects truncated,
overflowing, invalid-UTF8 and trailing data. Namespace/theme/editability and discrete
scheduling belong to the JS host. The current constructor accepts only the core
registry; foreign-class hooks, pure indexed reads and the complete shim
hosting contract remain pending.

The native host tests also execute real JS transforms through the normal model
fixpoint pipeline. Their scoped current-hook reborrows allow indexed API calls,
raw fields and live transform registration without an ancestor transaction pointer.
The tests cover nested editors, function identity, rollback and opaque exception
identity. This is not yet the full foreign-class or shim scheduling surface.

`listeners.test.ts` drives the development application's opaque command route.
The Rust model still owns priority ordering, snapshots and propagation stopping;
unrelated command identities are filtered before JS. Payloads can be cyclic
objects or browser events and preserve identity. This explicit-update route
retains the original exception value and leaves caught failures recoverable.
The future shim must allocate command identities, schedule idle dispatch and
propagate commands between parent editors. Tier A fixture codecs stay separate.

Host packet format2 adds a model-derived changed flag so the JS scheduler can
suppress no-op update listeners without guessing from diff operation counts.
The decoder rejects the earlier unreleased format and malformed boolean flags.
