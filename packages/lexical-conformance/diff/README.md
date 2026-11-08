# WP-07 Tier C: upstream text/paragraph

Install from the repository root, then run inside the package to use its pinned
Vitest version:

```sh
bun install --cwd packages/lexical-conformance --frozen-lockfile
\cd packages/lexical-conformance
STEPS=10000 bunx vitest run --config diff/vitest.config.mts
```

Prebuild the native collab bridge before running its independent profile:

```sh
cargo build -p document_session --example collab --features conformance -j4
bunx vitest run --config packages/lexical-conformance/diff/collab.config.mts
```

Run those commands from the repository root. The raw-model profile excludes collab;
the collab profile supplies the app's single Loro instance and Lexical bundle aliases.
Both profiles retain all their comparisons and fixed seeds.

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

U uses the pinned production source, a headless editor for transactions and a
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
