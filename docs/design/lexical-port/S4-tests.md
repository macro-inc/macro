# S4: Test spec for the Rust port of Lexical

Revision: R2.1 (R2.1 applies S1 R2.1's changes and S12 §0.2; see "R2.1 consistency" at the end. R1 resolved `audit-r1-D.md` and the test gaps of `audit-r1-B.md`; R2 resolves the
test-side findings of `audit-r2-2.md`, the conformance-wasm and wasm32-runner items of
`audit-r2-4.md`, one regression test per fresh divergence of `audit-r2-1.md`, and the S4
references of `audit-r2-3.md`; see "R1 resolutions" and "R2 resolutions" at the end). The full
generated traceability matrix is `S4-matrix.tsv`, produced by `S4-matrix-gen.ts` (§0.2).

Target: Lexical v0.45.0 (`target/lexical-upstream`), Macro at `wolf-rust-lexical`.
Builds on `SCOPE.md` §4 and the notes it cites. Crate names follow SCOPE §2c.
Every case count below was recounted for this spec from the 140 upstream unit test
files and the 46 `packages/lexical-core/tests` files: a per-test-body classifier
(callbacks, DOM drivers, DOM assertions), cross-checked against the hand-corrected
splits in `notes-core.md` and `notes-packages.md`, reusing `count_tests.py`. Loops that generate
cases (`for`, `forEach`, `describe.each`, the markdown table) are expanded by hand
where the notes already did so.

## 0. Summary

| Tier | What | Runs on | Cases |
| --- | --- | --- | ---: |
| A-rec | upstream, lexical-core and lexical-service tests, recorded once from upstream JS as data, replayed by a Rust interpreter; every fixture first replays on upstream JS itself (§1.3a) | `cargo test` (native) and wasm32 (`wasm-bindgen-test`) | 1,090 upstream + 501 lexical-core + 42 lexical-service = **1,633** fixtures (estimate; §1.9) |
| A-hand | tests whose JS callback mutates the document mid-update, plus the gap tests of §1.8a–§1.8d (P0 symbols no upstream test names, AMBIGUOUS pins, recorder self-tests) | `cargo test` | 64 ported + **≈ 180** gap tests (§1.8a–c), plus 8 recorder self-tests (§1.8d) |
| B | all 140 upstream unit files, unmodified, on the wasm core through the `lexical` shim, in two configs | vitest + jsdom | 2,193 cases; 2,166 runnable after 27 N/A |
| B-only | the 423 model cases reachable only through DOM events, HTML I/O or the shim's listener layer | (subset of B) | 423 |
| view | the 590 cases that assert DOM or React output | (subset of B) | 590 |
| C | differential fuzzing against upstream TS (including the production `TextFromView` path), the per-node generator, the gate fuzzer, the regex differential, the dev-document corpus, and shadow mode | node + wasm; dev; lexical-service | n/a |
| proptest | 14 oracle-free invariants on `lexical_model` | `cargo test` | n/a |
| perf | input → presented frame per keystroke from real key events, paired randomized A/B (≥ 30 pairs), instruction-count and work-counter gates, memory, size and startup gates, an app-level cell | Chrome (bare-metal gate, any runner for counters), iOS simulator + Android emulator (nightly trend), devices (release) | n/a |
| e2e | 30 Playwright scenarios over the swapped editor (documents, every other editor surface, AI peer, collab undo, render equivalence, faults), every existing editor-touching suite flag-parameterized, plus event-trace replay and native-keyboard runs | local stack; Chromium per PR, WebKit + Firefox nightly; iOS simulator + Android emulator nightly | n/a |
| matrix | every S2 export and every S2 §3 behaviour id, every S3 node, route, transformer and transformer list, every S7 §6 row, every audit-r2-1 divergence → exactly one primary test id or a closed-enum ledger entry (§0.2, `S4-matrix.tsv`) | CI (`just lexical-coverage --check`) | 2,793 rows |

The upstream pool is 2,193 cases: 1,153 model (A), 423 B-only, 590 view and 27 N/A.
SCOPE's ~2,150 is the same pool before the caret loops, the selection tables and
the table-node `hasHorizontalScroll` doubling were expanded.

Hand-ported tests are 4% of the model pool, not SCOPE's 10–15%, for three reasons:

- the seven `DEFAULT_NODES` test classes are ported to Rust once and treated as ordinary
  registered nodes;
- pure callbacks are replayed from recorded tapes (§1.4);
- listener-timing tests are B-only, because the Rust core has no listeners (SCOPE §2b).

**The recorder classifies every test while it runs (§1.3), and that classification
is authoritative.** The per-file numbers in §1.9 are the plan estimate it will replace.
No milestone gate cites a §1.9 number; gates cite `fixtures/index.json` and the matrix.

### 0.1 Traceability (applies to every tier)

Every test names what it covers, so "no feature is missed" is a checked property, not a
claim.

- **Tag convention.** Every A-hand test, Tier C command, generator, S8 story or invariant,
  e2e scenario and perf gate carries one doc comment line
  `/// covers: SEL-12, HIS-38, S3:node:CommentNode, S3:route:8, S7:41` (TS: `// covers: …`).
  IDs are S2 behaviour ids (`SEL-12`), S2 symbols (`S2:@lexical/utils:$dfsIterator`), S3
  nodes (`S3:node:<TS class>`), routes (`S3:route:<# in the S3 route map>`), transformers
  (`S3:tf:<const>`), S3 core requirements (`S3:CR-17`), and S7 §6 rows (`S7:<#>`). This is a
  comment, not a test helper: tests stay literal (CODING.md).
- **Owner lines (G-1c).** Every Rust item that implements an S2 behaviour carries
  `/// s2: HIS-15, HIS-16` (S1/S3 own the convention and the placement; S4 only reads it). A
  MODEL/BRIDGE id whose matrix `owner` is `rust:*` and that no `s2:` line names fails the CI rule
  below, so "which Rust item implements HIS-15" is answerable from the code.
- **Generated matrix.** `just lexical-coverage` writes
  `packages/lexical-conformance/coverage/matrix.json` from six sources:
  1. `coverage/seed-matrix.tsv`: the row list and each row's **primary test id** (§0.2). It is
     the copy of `S4-matrix.tsv`, regenerated from the specs, and is what the per-id rule reads;
  2. `fixtures/index.json`: per fixture, every API name it calls, every S2 `Src` range V8
     executed while it ran (§1.3 item 5), and every transformer that fired (§1.3 item 6);
  3. Tier B `results/<config>.json` (case → file → S2 package, plus the C2
     `rust_executed`/`js_fallback` counters per case);
  4. the `covers:` tags, collected by a grep over `crates/client/lexical/**`,
     `crates/client/doc_sync_core/**`, `crates/client/document_session*/**`,
     `crates/sync_protocol/**`, `tooling/sync-sim/**`, `packages/lexical-conformance/**`,
     `packages/lexical-wasm-shim/**`, `packages/collaboration/src/session/**` and the e2e
     directories;
  5. the `s2:` owner lines (grep over the same Rust paths);
  6. the ledgers (`coverage/ledger.json`, `tierb/ledger.json`, Tier A `ledger.json`).
- **CI rule (`just lexical-coverage --check`, per PR).** For every seed-matrix row:
  - `gate = required`: a test whose `covers:` names the row id exists in the row's
    `test_file` (or, when `test_file` is empty, anywhere in the source-4 paths), is not
    `#[ignore]`d or `.skip`ped, and ran in this pipeline. A row whose tier is
    `A-rec|A-hand` is satisfied by either: a fixture in `index.json` that calls the API and
    replays green with no ledger entry, or the named fallback literal test. A row whose tier is
    `A-rec(fired)|A-hand` is satisfied by a green fixture in which the transformer fired, or the
    fallback. A Tier B case counts for a Rust-owned row only when the case ran with
    `rust_executed > 0` for the row's names in config 2 (G-1d); a B case served entirely by JS
    fallbacks proves nothing about Rust.
  - `gate = ledger:<reason>`: the ledger has an entry for the row id with that reason and
    the cited spec line; the B tier still runs the row's upstream files.
  - `gate = blocked:no-rust-owner`: S1/S3 name no Rust item for a MODEL/BRIDGE export; the
    check fails until S1/S3 map it or list it as not ported (2 rows at R2, 0 at R2.1; the
    generator prints them).
  - **Ratchet, not a cliff.** `coverage/pending.txt` lists the row ids whose test has not landed
    yet. It starts as every `required` row and may only shrink: CI fails if a PR adds a line
    to it, and fails if a row not in it has no passing test. A milestone exit requires that no
    row of that milestone (`milestone` column) is pending. This is what makes the per-id rule
    enforceable from day one without failing ~2,000 rows on the first PR.
- **Ledger reasons for "no Rust test"** (`coverage/ledger.json`): `view-only` (S2 class
  VIEW), `not-ported` (S3 or S1 "not ported"/n/a line), `js-by-design` (a P0 name in a
  Tier B aliased package that is VIEW or not ported, §2.2), `dropped-route` (S3 Q12),
  `removed` (S7 §6 "removed" rows). Nothing else.
- **On the release PR** the matrix is rendered as a table (§8 is its hand-written,
  per-family summary) with per-family counts by tier.

### 0.2 Matrix generator (`gen-matrix.ts`) and the generated matrix (`S4-matrix.tsv`)

The per-id rule needs a per-id list of expected tests, so the list is generated, not written
by hand. At spec time the script is `S4-matrix-gen.ts` beside this file and writes
`S4-matrix.tsv` (2,793 rows at R2); in the repo the same file is
`packages/lexical-conformance/coverage/gen-matrix.ts`, run by `just lexical-coverage-seed`,
and writes `coverage/seed-matrix.tsv`. WP-09 commits S1/S2/S3/S4/S7/S8 to
`docs/design/lexical-port/` so the generator's inputs are in the tree; `just lexical-coverage-seed
--check` regenerates in memory and fails on any diff, so a spec edit that adds an id lands with
its row.

**Inputs** (read only): S2 §2 export rows and §3 behaviour items (id, item-level class tag,
AMBIGUOUS flag, line); S1 and S3 mapping tables (the column whose header says "Rust"), their
"Not ported" sections and n/a rows; S3's Macro node tables, route map, §4.2.6 transformer table,
§2.11 upstream transformer rows and the four Macro transformer lists in §4.2; S7 §6; S8's
`covers: S7:<n>` tags and story-table S7 columns; and S4's own named-test tables (§1.8a, §1.8e,
§1.8f, §1.8g, §8.2, §8.3, §8.4, §8.6). It also scans upstream `packages/**/__tests__` and Macro's
lexical-core, lexical-service and web `LexicalMarkdown` tests for each exported name.

**Rules, applied in this order** (the script is the normative statement; this is its summary):

| Row kind | Owner | Primary test id |
| --- | --- | --- |
| `beh`: S2 §3 id | class = the item's own tag, else the family class of §8.2; owner from the family table (`lexical_model`, `lexical_rich_nodes`, `lexical_markdown`, `lexical_html` for the HTML export subsection, `upstream-js` for `EXT`, `XB` except XB-04/11–15, `HREN`, `HIMP`, the HTML import subsections, `CODE-HL/PR/SH` (D6) and the React plugins other than `RX-CLEAR/TABLE/LIST/CHECK/MDSC/TAB/HIST`; `view` for VIEW items; `reference` for YJS) | Rust-owned: the §1.8g override, else `hand::<pkg>::ambiguous_<id>` for an AMBIGUOUS item (§1.8c), else **`s2::<family>::<id>`**, one literal test per id in `crates/client/lexical/lexical_conformance/tests/s2/<family>.rs` whose `fn` name starts with the id (`fn his_15_two_dirty_nodes_new_text_is_insert_character`). Not Rust-owned: Tier B on the package's upstream files plus a ledger entry (`view-only`, or `not-ported` citing the S3 line that names one of the item's identifiers, else the family's "Not ported" section) |
| `sym`: S2 export | S1/S3 status: a mapping row with a Rust item → `rust:<target>`; an n/a or "not ported" row → `upstream-js`; a `shim-only` target nobody maps → `shim`; otherwise `unowned` (`blocked`) | types: `types.test-d.ts::<entry>/<name>`; §1.8a/§1.8f override; a name some upstream or Macro test uses: `index:<entry>/<name>` (A-rec) with the fallback `s2sym::<pkg>::<name>` in `tests/s2sym/<pkg>.rs`; else that fallback alone. Re-export rows: the shim's `exports.test.ts` identity check. VIEW rows: Tier B + `view-only`. P0 VIEW or not-ported names in a Tier B aliased package: `js-by-design` (§2.2) |
| `node`: S3 Macro node | `macro_document_model` | `synthetic::<node>::every_route` (§3.6b) plus the §8.3 node-specific tests |
| `route`: S3 route map | `macro_document_model` | the §8.4 tests; routes 0–3 and 9 are `dropped-route` |
| `tf`: S3 §4.2.6 and §2.11 transformer | `macro_document_model` / `lexical_markdown` | `fired:<TS name>` (the recorder's firing trace, §1.3 item 6) with fallback `transformers::<const>_fires`; helper `fn` rows: `md_utils::<fn>` |
| `tf-order`: a transformer list | same | `transformers::<list>_order_equals_ts` (the recorded name list as a literal) |
| `s7`: S7 §6 row | `doc_sync_core` / `document_session` | §8.6, else the S8 story or invariant that `covers:` it; `removed` rows are ledgered |
| `div`: audit-r2-1 finding | the crate in §1.8e | the §1.8e regression test |
| `priv`: private field Macro reads | `shim` | the §1.8h `view_gaps` test |

**Columns** of the TSV: `kind`, `id` (exactly what `covers:` names: `HIS-15`, `LSEL-13`,
`S2:@lexical/utils:$dfsIterator`, `S3:node:CommentNode`, `S3:route:8`, `S3:tf:MACRO_ORDERED_LIST`,
`S7:111`, `S1:R2-01`), `package`, `class` (`(family)` marks an inherited class), `pri`, `owner`,
`gate`, `tier`, `test_id`, `test_file`, `also` (secondary coverage: the family's Tier C commands
and e2e from §8.2, the owning S1/S3 line, A-rec fixtures), `milestone`, `source` (spec and line).

**Duplicate ids (G-2).** The §3D copies of `SEL-01…SEL-51` are `LSEL-nn` (the S2 R2 rename).
Until S2 lands it, the generator applies the rename itself; any other duplicate is qualified
`<id>@<part>` and printed.

**Counts at R2** (`bun S4-matrix-gen.ts`): 2,793 rows. 1,140 export rows (904 MODEL/BRIDGE);
1,292 behaviour rows (1,213 MODEL/BRIDGE, 1,012 with a required Rust test, the rest ledgered
with a Tier B run); 9 private fields (§1.8h); 43 nodes; 18 routes; 99 transformers and 11
transformer lists; 123 S7 rows; 58 divergence regressions; 32 `js-by-design` names; 2
`blocked:no-rust-owner` exports (for S2/S3, listed in "R2 resolutions"; 0 at R2.1, see "R2.1
consistency"); 0 rows without a test.

---

## 1. Tier A: recorded fixtures replayed in Rust

### 1.1 What a fixture captures

A fixture is one upstream (or lexical-core) test as it actually ran on upstream JS:
- the editor config;
- the concrete sequence of public-API calls the test code made, with arguments and
  return values;
- a state snapshot at every commit;
- any thrown error.

It is a trace of what ran, not a translation of the code. Loops, conditionals and string
building in the test are frozen into values. A Rust replay that diverges shows up
as a mismatching return value at the first call where it differs.

### 1.2 Layout

```
packages/lexical-conformance/            # JS tooling (not shipped)
  upstream.lock                          # lexical v0.45.0 tarball URL + sha256
  record/
    vitest.record.mts                    # extends upstream vitest.config.mts
    membrane.ts                          # the $-API recording wrapper (§1.3)
    attribution.ts                       # call-site attribution (§1.3 item 2a)
    hooks.patch                          # hook lines in LexicalUpdates.ts/LexicalUtils.ts (record-time only, §1.3 item 3)
    entropy.ts                           # clock and randomness tapes (§1.3, B9)
    reporter.ts                          # vitest reporter → fixture files
    encode.ts                            # value encoding (§1.5)
    replay-js.ts                         # JS replay interpreter: the recorder self-check (§1.3a)
    __tests__/membrane.test.ts           # literal recorder tests (§1.8d)
  coverage/ gen-matrix.ts seed-matrix.tsv pending.txt matrix.json ledger.json   # §0.1, §0.2
  tierb/ diff/ corpus/ bench/ e2e-traces/  # §2, §3, §5, §6.4
crates/client/lexical/lexical_conformance/   # Rust, publish = false, dev-only
  src/fixture.rs                         # serde types for §1.5
  src/replay.rs                          # interpreter (§1.6)
  src/api/*.rs                           # one dispatch module per upstream package
  src/test_nodes.rs                      # the 7 DEFAULT_NODES test classes + Overflow
  src/source.rs                          # FixtureSource: std::fs natively, the node loader on wasm32 (§1.6)
  tests/replay.rs                        # libtest-mimic harness, one trial per fixture (native)
  tests/replay_wasm.rs                   # wasm-bindgen-test runner, one test per package (§1.6)
  tests/replay_wasm/loader.mjs           # node fs loader imported by replay_wasm.rs
  tests/hand/*.rs                        # A-hand tests (§1.8)
  tests/s2/<family>.rs                   # one literal test per S2 behaviour id (§0.2)
  tests/s2sym/<pkg>.rs                   # literal tests for exports no fixture calls (§0.2)
crates/client/lexical/lexical_conformance_wasm/  # dev-only cdylib for Tier B, Tier C "R", perf `core` (§2.8)
  fixtures/upstream/<pkg>/<file>/<test-slug>.json
  fixtures/macro/lexical-core/<file>/<test-slug>.json
  fixtures/fuzz/<sha8>.json              # shrunk Tier C failures (§3.4)
  ledger.json                            # Tier A expected failures (same format as §2.6)
```

`just lexical-fixtures` downloads the pinned upstream into `target/lexical-upstream/`,
applies `hooks.patch`, runs `vitest --config record/vitest.record.mts`, and rewrites
`fixtures/`. `just lexical-fixtures --check` re-records into a temp dir and fails on
any diff, so fixtures can't drift from the recorder. Re-recording is deterministic:
keys are reset per test, and every clock and entropy source is taped (`Date.now`,
`performance.now`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, and
nanoid through `getRandomValues`). In record mode an un-taped read of any of them throws,
which fails recording for that test loudly.

### 1.3 Recorder

Four pieces (resolver, membrane, hooks, dual DEV/production recording), all in the recording run only. Tier B and production never load them.

**1. Resolver.** `vitest.record.mts` is upstream's `vitest.config.mts` plus a
`resolveId` plugin (`enforce: 'pre'`):
- `lexical`, every `@lexical/*` package, and every deep import that resolves into
  `packages/*/src/**` outside `__tests__` resolve to `record/membrane.ts?target=<real path>`;
- that membrane module re-exports the real module, wrapped.

The deep-import set is the same one Tier B maps (§2.3), because tests import the
same internals: `$normalizeSelection`, `resetRandomKey`, `$internalCreateRangeSelection`,
and the rest. lexical-core's own exports (`composeAgentContextPrompt`, `toXml`,
`extractChannelMentionsFromMarkdown`, transformers, `$create*` for its 40 nodes) are
wrapped the same way. That makes its pure-function tests recordable too.

**2. Membrane (`membrane.ts`), the $-API recording wrapper.** It is a proxy boundary
between test code and Lexical. A call is recorded **by who made it, not by stack depth**,
because Lexical re-enters from async entry points (the microtask commit, DOM event
handlers, `selectionchange`, the MutationObserver, React effects, listener-enqueued
updates) with an empty JS stack, where a depth counter would read 0 and record Lexical's
own work as if the test had made it.

- **2a. Call-site attribution (`attribution.ts`).** Every wrapped function and method, on
  entry, captures `new Error().stack` (speed is irrelevant offline) and finds the nearest
  frame that is not in `membrane.ts`/`attribution.ts`. The call is recorded only when that
  frame's file is a test file or a test util: a path matching
  `**/__tests__/**`, `packages/lexical-core/tests/**`, `services/lexical-service/**/*.test.ts`,
  `services/lexical-service/test/**`, or a plugin test in `apps/web/**/LexicalMarkdown/**/*.test.ts`,
  and not under `packages/*/src/**` outside `__tests__`. Calls whose nearest frame is
  package source (a plugin's update listener, a transform in package code, the reconciler)
  are never recorded. `vitest.record.mts` sets `sourcemap: 'inline'` and
  `Error.stackTraceLimit = 200` so frames resolve to source paths.
- **2b. Depth as a second guard.** `let depth = 0` still counts nesting: a call made
  while `depth > 0` is never recorded, whatever its call site (a test-util helper that
  calls Lexical, which calls a test predicate, which calls a `$`-function, records only the
  outermost call). `depth` is incremented in `try` and decremented in `finally`.
- **2c. Async entry points carry depth.** `hooks.patch` wraps, in the pinned copy,
  `scheduleMicroTask` (`LexicalUtils.ts`), `$commitPendingUpdates` and
  `$triggerEnqueuedUpdates` (`LexicalUpdates.ts`), the root-element listeners added in
  `LexicalEvents.ts` (`addRootElementEvents`), the `selectionchange` document listener and
  the MutationObserver callback (`LexicalMutations.ts`) in `depth++ … finally depth--`. Work
  Lexical starts on its own is therefore at `depth ≥ 1` even with an empty stack, and 2a
  is the second line of defence.
- **2d. Callback depth semantics (B2).** When Lexical invokes a function argument the
  test passed (an `editor.update` closure, a predicate, a matcher), the callback wrapper
  saves `depth`, sets it to 0, runs the callback, and restores the saved value in
  `finally`. Calls made inside are attributed by 2a as usual. They are stored:
  - for `editor.update`/`editor.read`/`state.read` closures: in that op's `calls[]`;
  - for a tape callback (§1.4): in `tapes[n].invocations[k].calls`, never interleaved
    into the outer trace, so the outer call's trace stays one call;
  - a nested `editor.update` inside an update closure is its own `update` op with
    `parent: <outer update id>`.
- **2e. Deep, lazy containers (B3).** Arrays from `getChildren()`/`getNodes()`/
  `getChildrenKeys()`, the `Map` from `editorState._nodeMap`, the `Set` from
  `$getMarkIDs`, and plain objects containing nodes are returned as lazy proxies. An
  element read (`arr[i]`, `map.get(k)`, iteration, `size`, `length`) wraps the element
  through the same `WeakMap` cache and records the read as `get:[i]`, `Map.get`,
  `Set.has`, `iter`. A raw node therefore never leaves the membrane, so `toBe` against a
  proxied node from `$getNodeByKey` holds.
- **2f. Membrane transparency check (B3).** Every recorded test also runs once with the
  membrane disabled (resolver off, same seed and tapes). Both runs must have the same
  pass/fail and the same `expect.getState().assertionCalls`. Any difference fails
  recording for that test with `membrane-not-transparent`, and the test becomes B-only
  until the membrane is fixed. The reporter lists these.
- Class prototypes are patched in place, so subclasses defined in packages and tests
  inherit the wrapping:
  - `LexicalNode`, `ElementNode`, `TextNode`, `DecoratorNode`, `RootNode`,
    `ParagraphNode`, `LineBreakNode`, `TabNode`;
  - the selection classes;
  - `Point`, `EditorState`, `LexicalEditor`;
  - every exported node class of each package.
- Objects that leave the membrane through a recorded call (nodes, selections, points, editor states,
  editors) are returned as cached `Proxy` wrappers, one per target (`WeakMap`).
  - Identity (`toBe`) and `instanceof` therefore behave as before.
  - Arguments are unwrapped on the way in, so Lexical only ever sees raw objects.
- The proxy `get` trap records **property reads**: `selection.anchor`, `point.offset`,
  `node.__key`, `node.__text`, `editor._config`, and so on. Field-poking tests (40
  files) still yield complete traces.
- Function-typed arguments are wrapped as callbacks (§1.4).

**3. Hooks (`hooks.patch`).** Record-time lines in the pinned copy:
- `globalThis.__lexRec?.begin(editor, pendingState, cause)` at the top of `$beginUpdate`.
  It captures the selection that update starts from, which is DOM-derived when a root
  element is attached (`LexicalUpdates.ts:1004`), and the update's **cause**: `test` (the
  update was attributed to test code by 2a), `listener-enqueued` (queued from inside an
  update or mutation listener, i.e. during `$triggerUpdateListeners`), `transform`,
  `discrete`, `setEditorState`, `dom-event` (from a root listener of 2c), or `history`
  (`registerHistory`'s own `setEditorState`).
- `globalThis.__lexRec?.commit(editor, prev, next, tags, dirtyLeaves, dirtyElements, normalizedNodes)`
  at the end of `$commitPendingUpdates`. The commit's cause set is the union of its
  updates' causes (B5).
- `globalThis.__lexRec?.error(editor, err, during)` where `_onError` is invoked
  (`LexicalUpdates.ts` `$beginUpdate` catch, `$commitPendingUpdates` catch, listener
  catch), with `during: "update" | "commit" | "listener"` (B7).
- the 2c depth wrappers.

Hooks are used instead of a recorder-owned update listener, because tests assert
listener counts (`editor._listeners.update.size`) and listener ordering.

Per test, a setup file (`record/setup.ts`, added to `setupFiles` after upstream's
`vitest.setup.mts`) does these things:
- calls `resetRandomKey()` itself;
- installs the entropy and clock tapes (`entropy.ts`): `Date.now`, `performance.now`,
  `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`. Each read appends a value
  to the tape in trace order (`{"op":"clock","t":…}`, `{"op":"entropy","src":"random","v":…}`).
  Code paths that read entropy before setup (module top level) are taped at import with
  `src: "module-init"`;
- wraps `queueMicrotask` and `scheduleMicroTask` so every microtask checkpoint that runs a
  Lexical commit or listener emits a `{"op":"tick","n":…}` op (B8): replay batching is data,
  not inference. `editor.read`'s flush of pending updates, `onUpdate` callbacks and
  `await editor.update()` resolution are recorded as `tick` boundaries with
  `reason: "read-flush" | "onUpdate" | "await"`;
- registers `process.on('unhandledrejection')` and the `_onError` hook (B7). An error that
  upstream produced and the recorder did not capture fails recording;
- in `afterEach`, drains until `editor._pendingEditorState === null` and no update is
  queued on any editor the test created (not a fixed number of microtasks), takes the
  final snapshot, and puts the fixture on `task.meta.lexicalFixture`.

**4. DEV and production oracles (B6).** Each test is recorded twice: once against the
upstream source with `__DEV__ = true` (vitest's default) and once with `__DEV__ = false`
(the resolver serves the same source with the `__DEV__` define flipped). When the two
traces differ (a DEV-only invariant throws, or `errorOnReadOnly` fires), the fixture
carries `outcomeDev` and `outcomeProd` per differing call. **Rust follows the production
outcome; its error text follows the DEV message.** The ledger reason is
`dev-only-invariant` (S1 D-11 lists which checks Rust keeps always-on; those replay the
DEV outcome).

**5. Source-range coverage per fixture (G-1b).** The DEV recording runs under V8 coverage
(`NODE_V8_COVERAGE` through vitest's `coverage.provider: 'v8'`, per-test reset with
`v8.takeCoverage()` in the setup file). For each fixture the reporter intersects the executed
ranges of the pinned upstream source with the `Src` range of every S2 §3 item (S2 R2 adds the
`Src` column; until then the generator's parse of the item's `(file:line)` cite) and writes the
hit ids to `index.json` as `s2Hits`. This is evidence, not a substitute: the per-id rule still
needs the row's primary test (§0.1), and `lexical-coverage` prints, per id, the fixtures that
execute it next to its literal test, so a literal test that contradicts a fixture is visible.

**6. Transformer firing trace (G-6a).** Transformers are values in arrays, not calls, so "the
fixture's API list names the const" cannot work. The membrane wraps every transformer object
reachable from the markdown entry points (`TRANSFORMERS`, the upstream groups, lexical-core's
`INTERNAL/EXTERNAL/ALL/CUSTOM_TRANSFORMERS` and every const they hold): `regExp`/`regExpStart`/
`regExpEnd` `exec`, `replace`, `export`, `handleImportAfterStartMatch` and `getEndIndex` record
`{transformer: <TS name>, hook, matched: bool}` when they return a match or a non-null value.
`index.json` gets `transformersFired: [<TS name>…]` per fixture. That is the `fired:` source of
§0.2's `tf` rows.

### 1.3a Recorder self-check: every fixture replays on upstream first

`record/replay-js.ts` is a JS replay interpreter with the same semantics as the Rust one
(§1.6): it reads only the fixture, creates the editors from `config`, re-enables the
listed `plugin` ops, executes each recorded call against **upstream** v0.45.0, compares
every return value and every `commit` snapshot, and runs `tick` ops as batching
boundaries.

- A fixture is written only if it replays on its own oracle with zero mismatches.
  A failing self-replay rejects the fixture with `self-replay-failed: <op index>` in
  `fixtures/index.json`, and the test becomes B-only until the recorder is fixed.
- This is the guard against "fixtures pass while Rust is wrong": a fixture that recorded
  plugin work as test calls (B1) replays it twice on upstream (the call, then the
  plugin again), and fails here instead of passing in Rust with the Rust plugin missing.
- `just lexical-fixtures --check` runs the self-check on every fixture.
- The literal tests in §1.8d pin the recorder's behaviour on the cases that motivated
  this design (listener-enqueued shortcut, nested update, tape predicate that calls back).

**Reporter (`reporter.ts`).** In `onTestCaseResult(testCase)` it reads
`testCase.meta().lexicalFixture`:
- it writes the fixture only if the test **passed** upstream (a failing upstream test is
  not an oracle);
- it writes `fixtures/index.json`: one row per test with its tier, the reason for that
  tier, its call count, and every API name used. This index is the source for §1.9 and
  for the interpreter's coverage report.

**Runtime tier classification.** These rules decide, test by test:

| Observed while running | Tier |
| --- | --- |
| Only recorded (test-attributed) calls, with pure or tape-able callbacks; self-replay (§1.3a) and transparency (2f) pass | A-rec |
| A test-attributed callback that made a mutating call (`getWritable`, `set*`, `append`, `remove`, `insert*`, `$setSelection`, …) while Lexical was running it: a transform, a command handler, an update or mutation listener, `insertNewAfter` overridden in a test class | A-hand |
| `registerUpdateListener`/`registerMutationListener`/`registerTextContentListener` with assertions on how often or with what they were called | B-only (listener layer is shim-side) |
| Any `dispatchEvent`, `KeyboardEvent`/`InputEvent`/`CompositionEvent`/`ClipboardEvent`/`DragEvent`, `DataTransfer`, `$generateNodesFromDOM`, `DOMParser`, `applyDOMRange`, selection DSL (`moveNativeSelection`, `pasteHTML`) made by test code | B-only |
| Assertions read `innerHTML`/`outerHTML`/`createDOM`/`exportDOM`/`getElementByKey`/DOM selection, or React render output | view |
| A test-defined class that registers with the editor and overrides a model hook | A-hand, unless the class is one of the seven `DEFAULT_NODES` test classes (ported once in `test_nodes.rs`) |
| `vi.mock`/`vi.spyOn` of a Lexical internal | B-only |

A test can be partially recordable. For example, it may build state through events and
then call `$convertToMarkdownString`. Such a test is recorded with
`initial = <state at the first recordable call>` and `partial: true`. The markdown
`can export ×85` rows work exactly this way: upstream builds the input from HTML with
`DOMParser` + `$generateNodesFromDOM`, and the fixture starts from the resulting
JSON.

### 1.4 Callbacks: tapes vs hand-ports

Most function arguments in model tests are pure:
- predicates (`$findMatchingParent(n, (x) => $isListNode(x))`);
- URL matchers;
- `getMatch` text-entity callbacks;
- markdown `replace`/`getEndIndex` from the *stock* transformers;
- `editor.update`/`editor.read` closures (test code itself).

The membrane handles each kind:

| Kind | Encoding | Replay |
| --- | --- | --- |
| `editor.update(fn, opts)`, `editor.read(fn)`, `state.read(fn)` | `{"op":"update"\|"read", "calls":[…]}`: the closure body's attributed calls (2d) | run calls inside one `Transaction` / `&EditorState` |
| A wrapped export passed by reference (`$isTextNode`) | `{"$fn":"lexical.$isTextNode"}` | dispatch the Rust equivalent |
| Inline pure callback (no mutating call while it ran) | `{"$tape": n}`; the fixture's `tapes[n]` holds every invocation in order: `{"args":[…], "ret":…, "calls":[…]}`, where `calls` are the read-only membrane calls the callback made (2d) | the Rust side calls a `TapeFn` that asserts the arguments of the k-th invocation match, replays its `calls` as reads, and returns the recorded value; extra or missing invocations fail the fixture. Order is strict by default; `tapes[n].order = "multiset"` (compare invocations as a multiset) is allowed only through a `ledger.json` entry with reason `tape-order` and a written argument for why Rust's order may differ (B10) |
| Transformer `replace(node, match)` from a stock upstream or lexical-core transformer | `{"$transformer":"@lexical/markdown.BOLD_STAR"}` | the Rust transformer of the same name |
| `Date.now`/`performance.now` read by `@lexical/history` (merge interval) or by our code | `{"op":"clock","src":"date"\|"perf","t":1730900000123}` events in trace order | the replay `Clock` returns them in order |
| `Math.random`, `crypto.randomUUID`, `getRandomValues` (nanoid ids, nodeIdPlugin, `awaitId`) | `{"op":"entropy","src":…,"v":…}` in trace order | the replay `IdSource`/`Rng` returns them in order; an extra or missing read fails the fixture |
| Impure callback | test becomes A-hand; fixture not written | §1.8 |

Recorded tapes make "the Rust core calls the callback with the same arguments, the same
number of times, in the same order" a checked property, which is stronger than the
upstream assertion.

### 1.5 Fixture schema

```jsonc
{
  "schema": 2,
  "source": {
    "repo": "lexical", "version": "0.45.0",
    "file": "packages/lexical/src/__tests__/unit/LexicalNormalization.test.tsx",
    "test": ["LexicalNormalization tests", "$normalizeSelection", "paragraph to text nodes"],
    "recordedWith": "lexical-conformance@<sha>"
  },
  "tier": "A-rec",
  "partial": false,
  "covers": ["NRM-03", "SEL-41"],          // S2 ids, derived from the APIs the trace calls (§0.1)
  "normalize": [],                         // named normalizations (§1.7), never implicit
  "outcomeDiffers": [],                    // [{op, call, outcomeDev, outcomeProd}] (§1.3 item 4)
  "config": {
    "namespace": "test",
    "nodes": ["heading","list","listitem","quote","code","table","tablecell","tablerow",
              "hashtag","code-highlight","autolink","link","overflow","test_block",
              "test_segmented","test_exclude_from_copy_block","test_decorator",
              "test_inline_block","test_shadow_root","test_text","mark"],
    "replacements": [],
    "plugins": [{"name": "@lexical/rich-text.registerRichText", "args": []}],
    "theme": null,
    "editable": true,
    "rootElement": true
  },
  "initial": {"editorState": null, "selection": null},
  "trace": [ /* ops, below */ ],
  "tapes": [],
  "final": { /* Snapshot */ }
}
```

**Ops** (`trace[]`, in execution order):

| `op` | Fields |
| --- | --- |
| `createEditor` | `id`, `config` (as above; nested editors get their own id and `parent`) |
| `update` | `id`, `editor`, `parent?` (enclosing update id for a nested update, 2d), `cause` (§1.3 item 3), `opts {tag[], discrete, skipTransforms}`, `selectionAtBegin` (only when it differs from the cloned pending selection, i.e. was DOM-derived), `calls[]`, `error?` |
| `read` | `editor`, `state?` (handle of a non-current `EditorState`), `calls[]` |
| `commit` | `editor`, `index` (per-editor commit counter, used by handles), `updates[]` (ids of the `update` ops this commit flushed, so batching is explicit), `causes[]`, `snapshot` |
| `tick` | `n`, `reason` (`microtask`, `read-flush`, `onUpdate`, `await`): a batching boundary (B8) |
| `error` | `editor`, `during` (`update`, `commit`, `listener`), `name`, `message`: an error routed through `_onError` or an unhandled rejection (B7) |
| `entropy` | `src`, `v` (§1.4) |
| `call` | a recorded call outside any update (`editor.getEditorState()`, `editor.parseEditorState(json)`, `editor.setEditorState(h)`, `editor.dispatchCommand`, `editor.setEditable`, `$convertFromMarkdownString` inside `update` is a normal call) |
| `plugin` | `name` (`@lexical/history.registerHistory`, `@lexical/markdown.registerMarkdownShortcuts`, …), `args` |
| `clock` | `t` |
| `log` | `level`, `message`: `console.error`/`warn` emitted by Lexical or lexical-core (`internal-transformer-fallbacks` asserts these) |

**Call**: `{"fn": "<module>.<name>" | "<Class>.<method>" | "get:<prop>", "this": Value?, "args": [Value], "ret": Value}`,
or `"throws": {"name": "Error", "message": "<exact text>"}` instead of `ret`.
Module names are package specifiers (`lexical`, `@lexical/list`,
`lexical/LexicalNormalization` for deep imports).

**Value encoding:**

| JS value | JSON |
| --- | --- |
| string, number, boolean, null | itself (`-0`, `NaN`, `Infinity` → `{"$num":"-0"}` etc.) |
| `undefined` | `{"$undef":true}` |
| node | `{"$h": n}`; the **first** occurrence adds `"key":"3","type":"text","ver":c`. `n` is per JS object, so a pre-`getWritable()` reference and its writable clone are different handles with the same key. `ver` is the `commit.index` of the state the object belongs to (the pending state's index is the next commit's), so a handle is `(key, version)` (B4) |
| `RangeSelection` / `NodeSelection` / `TableSelection` | `{"$sel": n}`; first occurrence adds `"kind"` |
| `Point` | `{"$pt": n}` (points are mutable objects with identity) |
| `EditorState` | `{"$state": n}` |
| editor | `{"$ed": n}` |
| a string that equals the key of a known handle | `{"$key": n, "raw": "3"}` |
| node class | `{"$klass": "paragraph"}` (registered type name) |
| command | `{"$cmd": "FORMAT_TEXT_COMMAND"}` |
| `NodeCaret` / `CaretRange` | `{"$caret": n}`, first occurrence adds `{"origin": {"$h"}, "direction", "type"}` |
| array / plain object | recursively encoded |
| `Map`, `Set` | `{"$map": [[k, v]]}`, `{"$set": [v]}` (insertion order kept) |
| function | §1.4 |
| `KeyboardEvent`-like payload (only `KEY_TAB_COMMAND` in code tabs and similar model commands) | `{"$event":"keydown","key":"Tab","shiftKey":true}` |

**Snapshot** (in `commit` and `final`):

```jsonc
{
  "json": { /* editorState.toJSON(), exactly */ },
  "selection": null
    | {"type":"range",
       "anchor": {"key": {"$key":3,"raw":"3"}, "path":[0,0], "offset":1, "type":"text"},
       "focus":  {"key": {"$key":4,"raw":"4"}, "path":[0,1], "offset":1, "type":"text"},
       "format": 0, "style": "", "isBackward": false}
    | {"type":"node", "keys":[{"$key":7,"raw":"7"}], "paths":[[2]]}
    | {"type":"table", "tableKey":…, "anchorCellKey":…, "focusCellKey":…},
  "text": "ab",                         // $getRoot().getTextContent()
  "markdown": {"TRANSFORMERS": "ab"},   // only when @lexical/markdown is loaded; one entry per transformer set the test used
  "tags": ["history-merge"],
  "dirty": {"leaves": [3,4], "elements": [[2,true],["root",false]]},   // handles; for commit snapshots only
  "normalized": [],                     // keys merged away by normalization
  "history": {"canUndo": true, "canRedo": false},   // when registerHistory is active
  "nodeMapKeys": ["root","1","2","3","4"]           // map keys in insertion order
}
```

Paths are child indexes from the root. They let the replay compare positions without
trusting key allocation.

A complete fixture, for upstream `LexicalNormalization.test.tsx` "paragraph to text
nodes". Keys and snapshot values are illustrative; the recorder writes whatever upstream produced:

```json
{
  "schema": 2,
  "source": {"repo": "lexical", "version": "0.45.0",
             "file": "packages/lexical/src/__tests__/unit/LexicalNormalization.test.tsx",
             "test": ["LexicalNormalization tests", "$normalizeSelection", "paragraph to text nodes"]},
  "tier": "A-rec",
  "partial": false,
  "covers": ["NRM-01", "SEL-05"], "normalize": [], "outcomeDiffers": [],
  "config": {"namespace": "test", "nodes": ["heading","list","listitem","quote","code","table","tablecell","tablerow","hashtag","code-highlight","autolink","link","overflow","test_block","test_segmented","test_exclude_from_copy_block","test_decorator","test_inline_block","test_shadow_root","test_text","mark"], "replacements": [], "plugins": [], "theme": null, "editable": true, "rootElement": true},
  "initial": {"editorState": null, "selection": null},
  "trace": [
    {"op": "update", "id": 1, "editor": 0, "cause": "test", "opts": {"tag": [], "discrete": false, "skipTransforms": false}, "calls": [
      {"fn": "lexical.$getRoot", "args": [], "ret": {"$h": 1, "key": "root", "type": "root", "ver": 1}},
      {"fn": "lexical.$createParagraphNode", "args": [], "ret": {"$h": 2, "key": "1", "type": "paragraph", "ver": 1}},
      {"fn": "lexical.$createTextNode", "args": ["a"], "ret": {"$h": 3, "key": "2", "type": "text", "ver": 1}},
      {"fn": "lexical.$createTextNode", "args": ["b"], "ret": {"$h": 4, "key": "3", "type": "text", "ver": 1}},
      {"fn": "ElementNode.append", "this": {"$h": 2}, "args": [{"$h": 3}, {"$h": 4}], "ret": {"$h": 2}},
      {"fn": "ElementNode.append", "this": {"$h": 1}, "args": [{"$h": 2}], "ret": {"$h": 1}},
      {"fn": "ElementNode.select", "this": {"$h": 2}, "args": [], "ret": {"$sel": 1, "kind": "range"}},
      {"fn": "get:anchor", "this": {"$sel": 1}, "ret": {"$pt": 1}},
      {"fn": "get:__key", "this": {"$h": 2}, "ret": {"$key": 2, "raw": "1"}},
      {"fn": "Point.set", "this": {"$pt": 1}, "args": [{"$key": 2, "raw": "1"}, 0, "element"], "ret": {"$undef": true}},
      {"fn": "get:focus", "this": {"$sel": 1}, "ret": {"$pt": 2}},
      {"fn": "get:__key", "this": {"$h": 2}, "ret": {"$key": 2, "raw": "1"}},
      {"fn": "Point.set", "this": {"$pt": 2}, "args": [{"$key": 2, "raw": "1"}, 2, "element"], "ret": {"$undef": true}},
      {"fn": "lexical/LexicalNormalization.$normalizeSelection", "args": [{"$sel": 1}], "ret": {"$sel": 2, "kind": "range"}},
      {"fn": "get:anchor", "this": {"$sel": 2}, "ret": {"$pt": 3}},
      {"fn": "get:type", "this": {"$pt": 3}, "ret": "text"},
      {"fn": "Point.getNode", "this": {"$pt": 3}, "args": [], "ret": {"$h": 3}},
      {"fn": "get:__key", "this": {"$h": 3}, "ret": {"$key": 3, "raw": "2"}},
      {"fn": "get:__key", "this": {"$h": 3}, "ret": {"$key": 3, "raw": "2"}},
      {"fn": "get:offset", "this": {"$pt": 3}, "ret": 0},
      {"fn": "get:focus", "this": {"$sel": 2}, "ret": {"$pt": 4}},
      {"fn": "get:type", "this": {"$pt": 4}, "ret": "text"},
      {"fn": "Point.getNode", "this": {"$pt": 4}, "args": [], "ret": {"$h": 4}},
      {"fn": "get:__key", "this": {"$h": 4}, "ret": {"$key": 4, "raw": "3"}},
      {"fn": "get:__key", "this": {"$h": 4}, "ret": {"$key": 4, "raw": "3"}},
      {"fn": "get:offset", "this": {"$pt": 4}, "ret": 1}
    ]},
    {"op": "commit", "editor": 0, "index": 1, "updates": [1], "causes": ["test"], "snapshot": {
      "json": {"root": {"children": [{"children": [
          {"detail": 0, "format": 0, "mode": "normal", "style": "", "text": "ab", "type": "text", "version": 1}],
        "direction": null, "format": "", "indent": 0, "type": "paragraph", "version": 1, "textFormat": 0, "textStyle": ""}],
        "direction": null, "format": "", "indent": 0, "type": "root", "version": 1}},
      "selection": {"type": "range",
        "anchor": {"key": {"$key": 2, "raw": "1"}, "path": [0], "offset": 0, "type": "element"},
        "focus": {"key": {"$key": 2, "raw": "1"}, "path": [0], "offset": 2, "type": "element"},
        "format": 0, "style": "", "isBackward": false},
      "text": "ab", "tags": [], "normalized": [{"$key": 4, "raw": "3"}],
      "nodeMapKeys": ["root", "1", "2"]}}
  ],
  "tapes": [],
  "final": {"same_as_last_commit": true}
}
```

### 1.6 Rust replay interpreter

`lexical_conformance::replay::Replayer` owns:
- `editors: Vec<Editor>`;
- handle tables `nodes: Vec<Option<NodeKey>>`, `selections`, `points`, `states`, `carets`;
- the active `Transaction`, if any;
- the clock tape and the callback tapes.

Dispatch is one hand-written `match` per package module, keyed by `fn`:
`api/lexical.rs`, `api/list.rs`, `api/markdown.rs`, `api/lexical_core.rs`, and so on.
That means about one Rust arm per upstream API, roughly 600 arms for everything the
fixtures touch, and not ~25 LOC per test. An unmapped `fn` fails its fixture with
`unmapped API: <fn>`. `cargo test -p lexical_conformance -- --report-coverage` prints
which APIs block how many fixtures, which orders the porting work.

Semantics the interpreter must reproduce:

1. **Batching.** Consecutive `update` ops before a `commit` share one pending state, as
   upstream's microtask batching does. Boundaries come from `tick` ops, never from
   inference (B8).
   - The interpreter opens a `Transaction` on the first `update` and calls
     `tx.flush()` (S1 §7.1) after each update's calls. That runs selection transforms, the
     transform fixpoint and GC, exactly what upstream's `$beginUpdate` does per update.
   - On `commit` it calls `tx.commit()`. `discrete` updates commit immediately.
   - **Requirement on `lexical_model` (S1):** `Transaction::flush` is the per-update
     boundary, separate from `commit` (S1 §7.1 already has it; S4 R0's `end_update` is
     renamed to match, C7).
   - **Cascades (B5).** An `update` with `cause: "listener-enqueued"` is not executed by the
     replay: it is the upstream plugin's own work, and the Rust plugin (registered from the
     fixture's `plugin` ops) does the same work inside the test update's `Transaction`
     (SCOPE §2b: Rust has no listeners). The commits a cascade produces are compared under
     the `cascadeCommits` normalization (§1.7): every commit whose causes include `test`
     is compared as usual except that it is compared **after** the cascade it started has
     drained, against the last commit of that cascade; intermediate cascade commits are
     not compared. The fixture lists `cascadeCommits` in `normalize`, so it is never
     silent.
2. **`selectionAtBegin`.** When present, it is applied with `tx.set_selection` before the
   update's calls. That is how DOM-derived selections reach a headless replay.
3. **Errors.** A recorded `throws` must come back as `Err(e)` with
   `e.to_string() == message`, byte for byte. That covers the 17 `toThrow('msg')` sites,
   so invariant texts are ported verbatim. An `update` with `error` must leave the
   committed state equal to the previous commit, with one exception: an undo/redo (or any
   step that calls `Transaction::set_editor_state`) commits pending work early, so its
   failure returns `ApplyError { error, committed }` with that early commit in `committed`
   (S1 §15.2, F-24). The replay and the differential then compare the state against
   `committed.last().next`, as upstream keeps the early commit too, and record the early
   commit as a commit of its own.
   `error` ops (B7) must be matched by an `Err` from the corresponding Rust step with the
   same message and `during`; an `error` the replay does not reproduce fails the fixture.
4. **Return values.**
   - Primitives must be equal.
   - A `{"$h": n}` with a new n binds n to `(NodeKey, ver)`: the returned key and the
     version (commit index) of the state it was read from. A known n must be the same key.
   - **Stale handles (B4).** A `get:<field>` or method call on a handle whose `ver` is
     older than the pending state resolves against the committed `EditorState` of commit
     `ver`. States are persistent `Arc`s (S1 §5.1), so the replay keeps one per commit
     index. This is how a test that holds a pre-`getWritable()` reference and reads
     `__text` from it replays. `getLatest()` on a stale handle returns the current-version
     handle of the same key.
   - `{"$key": n}` arguments resolve through the table.
5. **Snapshot comparison.**
   - `json` uses structural equality after the normalizations in §1.7. It is compared
     with the property order *ignored* and then, separately, the serialized string with
     property order *kept* (upstream preserves order deliberately, see
     `LexicalTextNode.ts:706`).
   - `selection` compares paths, offsets, types, format, style and backwardness. Keys
     are compared through the handle bijection.
   - `text`, `markdown`, `tags`, `normalized` and `history` must be equal.
   - `dirty` is compared as sets, because Rust's dirty sets come from the same algorithm
     but must not be forced to match JS `Set` iteration where order isn't observable.
     The transform loop order is observable and is checked via tapes instead.
6. **Keys.**
   - In **bijection mode** (default), each fixture key maps to a Rust key on first
     sight and must stay consistent.
   - In **strict mode**, enabled per package in `ledger.json` once it passes,
     `NodeKey::to_string()` must equal `raw`. That proves allocation order matches
     upstream's counter, which Tier B needs anyway (`resetRandomKey`, §2.3).
7. **Logs.** `log` ops are compared for lexical-core fixtures, against the `tracing` events
   (level and message) the replay's test subscriber captures during that step: S1 has no
   diagnostics channel on `Commit`, and S3 turns `console.error`/`warn` into `tracing` events
   (S3 §2, §4.2). For upstream fixtures they are advisory (DEV-only warnings).

Harness: `tests/replay.rs` is a `harness = false` test using `libtest-mimic`. Each
fixture becomes a named trial, for example
`upstream::lexical::LexicalNormalization::paragraph_to_text_nodes`. That keeps
`cargo test <filter>` working per test. On failure it prints:
- the op index;
- the call;
- expected vs actual;
- a JSON diff (`similar`) of the first mismatching snapshot.

**wasm32 replay (H6).** `libtest-mimic` (`harness = false`) cannot run under
`wasm-bindgen-test`, which runs only `#[wasm_bindgen_test]` functions, and `std::fs` does not
exist on `wasm32-unknown-unknown`. So the interpreter is target-independent and the fixture
source is a trait:

```rust
// src/source.rs
pub trait FixtureSource {
    /// Fixture paths relative to `fixtures/`, sorted, filtered by `LEXICAL_FIXTURE_FILTER`.
    fn list(&self, package: &str) -> Result<Vec<String>, SourceError>;
    fn read(&self, path: &str) -> Result<String, SourceError>;
}
pub struct FsSource { pub root: std::path::PathBuf }           // native: tests/replay.rs
#[cfg(target_arch = "wasm32")]
pub struct NodeSource;                                          // wasm32: tests/replay_wasm.rs
```

`tests/replay_wasm.rs` (wasm32 only; no `wasm_bindgen_test_configure!`, so
`wasm-bindgen-test` runs it in node, its default):

```rust
#[wasm_bindgen(module = "/tests/replay_wasm/loader.mjs")]
extern "C" {
    // loader.mjs: node:fs readdirSync/readFileSync under the crate's fixtures/ dir, and
    // process.env.LEXICAL_FIXTURE_FILTER.
    #[wasm_bindgen(catch)] fn list_fixtures(package: &str) -> Result<Vec<String>, JsValue>;
    #[wasm_bindgen(catch)] fn read_fixture(path: &str) -> Result<String, JsValue>;
}

/// One test per fixture package; it replays every fixture of that package and fails with the
/// full list of failing fixture ids (and, per id, the same op index / expected / actual text
/// the native harness prints), so a failure names fixtures, not "package failed".
#[wasm_bindgen_test]
fn upstream_lexical() { replay_package(&NodeSource, "upstream/lexical") }
// … one fn per directory under fixtures/upstream/, fixtures/macro/lexical-core, fixtures/fuzz;
// `build.rs` writes the list into `$OUT_DIR/packages.rs` (included here) so a new package
// directory gets its test without an edit, and the build fails if a directory has none.
```

Fixtures are not `include_bytes!`'d: 1,633 JSON files would make a test module of tens of MB.
The runner is `cargo test -p lexical_conformance --target wasm32-unknown-unknown --test
replay_wasm` with `CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner`
(wasm-bindgen-cli pinned to the workspace's `wasm-bindgen` 0.2.123), wrapped as `just
lexical-replay-wasm`. It runs in node (the loader needs `node:fs`); no browser is needed,
because the point is the wasm32 build of the same Rust code (UTF-16 and `regress` paths are the
same code, but allocation and float formatting are not). `libtest-mimic` is added to
`[workspace.dependencies]` by WP-00.
Native mobile (M5) reruns the native `tests/replay.rs` on `aarch64-apple-ios-sim` and an
Android emulator.

### 1.7 Normalizations applied before comparing

Each normalization is listed in the fixture's `normalize` field and in `ledger.json`
when a package needs it. None is applied silently.

| Normalization | Why |
| --- | --- |
| `codeHighlight`: collapse `code-highlight` children of a `code` node into one text run; selection points inside them become `(code key, absolute UTF-16 offset)` | D6: highlighting is view-only, so the Rust model has no `CodeHighlightNode`s. Applies to the 84 prism tab cases, `LexicalCodeNode`, and lexical-core `tables`/`paste` fixtures with code blocks. |
| `nodeIds`: compare NodeState `id`/`peerId` through a bijection | nodeIdPlugin ids are random. The fixture tapes the id generator instead when lexical-core runs with nodeIdPlugin, so this is only needed for ids minted outside the tape. |
| `listIndent: 2` | Macro's markdown patch (`LIST_INDENT_SIZE` 4→2). Upstream markdown fixtures are recorded **unpatched** (indent 4) and the Rust engine replays them with `ListIndent(4)`. lexical-core fixtures are recorded with the patch and replay with `ListIndent(2)`. This replaces the patch with a config value (SCOPE Risks). |
| `clearTextPatch` | upstream `$clearText` appends an empty TextNode; ours doesn't. Upstream table fixtures that observe it replay with `TableOptions { clear_appends_empty_text: true }`; Macro's guard test (`tableClear.test.ts:135`) is recorded from the patched build. |
| `mutationTiming` | upstream fires no mutation listeners headless; Rust always computes mutations. Only listener (B-only) tests observe this, so this is a Tier B ledger reason, not a Tier A normalization. |
| `cascadeCommits` | upstream plugins that enqueue updates from listeners (markdown shortcuts, nodeIdPlugin's mutation listener, the table selection observer, history's `setEditorState`) produce extra commits; Rust does that work inside one `Transaction` (SCOPE §2b). Compared as §1.6 item 1 says: each test-caused commit after its cascade drains, intermediate cascade commits skipped. Listed per fixture. |
| `devOutcome` | a DEV-only invariant throws in the DEV recording and not in production (§1.3 item 4). Rust replays the production outcome; the DEV message is checked only for checks S1 D-11 keeps always-on. Ledger reason `dev-only-invariant`. |

### 1.8 Hand-ported tests (A-hand)

There are 64 tests, in `tests/hand/<package>.rs`, with one sibling file per upstream
test file (CS-49: tests in sibling files, not inline). They follow the repo test rules
(CODING.md "Explicit literals, no tiny helpers"):
- each file starts with one complete, literal test;
- no builder DSL;
- expected JSON written out in full with `serde_json::json!`;
- each test names its upstream source in a doc comment.

Test-defined classes become Rust structs in the same file.

```rust
/// upstream: packages/lexical/src/__tests__/unit/LexicalEditor.test.tsx
/// "Should be able to register node transforms that run to a fixpoint"
#[test]
fn text_transform_runs_until_nothing_is_dirty() -> Result<(), Box<dyn std::error::Error>> {
    // A non-capturing closure coerces to `TransformFn<Text>` (S1 §8.2: transforms are fn items).
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(|tx, id| {
            let text = tx.text_data(id)?.text.as_str().to_owned();
            if text != text.to_uppercase() {
                tx.text(id)?.set_text_content(&text.to_uppercase())?;
            }
            Ok(())
        })
        .build()?;

    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("hello")?;
        tx.append(paragraph, &[text.key()])?;
        let root = tx.root();
        tx.append(root, &[paragraph.key()])?;
        Ok(())
    })?;

    assert_eq!(
        serde_json::to_value(editor.state().to_json()?)?,
        json!({"root": {"children": [{"children": [
            {"detail": 0, "format": 0, "mode": "normal", "style": "", "text": "HELLO",
             "type": "text", "version": 1}],
            "direction": null, "format": "", "indent": 0, "type": "paragraph",
            "version": 1, "textFormat": 0, "textStyle": ""}],
          "direction": null, "format": "", "indent": 0, "type": "root", "version": 1}})
    );
    Ok(())
}
```

A-hand tests get their expected values by running the upstream test and copying what it
asserts. They never come from the Rust output. The PR that adds one includes the
upstream assertion it mirrors.

The listener and command tests marked B-only have a smaller Rust counterpart. About 20
hand tests in `tests/hand/commit.rs` assert `Commit` contents (`changes`, `tags`,
`normalized`, mutation kinds) for the same scenarios, so the model side of listener
semantics has native coverage.

The rules above (literal first test, no DSL, expected values from an upstream run, the
upstream assertion in the PR) apply to every gap test in §1.8a–§1.8d. Each carries a
`covers:` line (§0.1).

### 1.8a P0 symbols that no upstream test names (A2, A3)

A whole-word search of the 268 Macro-used symbols (`symbols.json`) over every upstream
`__tests__` file, excluding playground and website, finds **66 with no match: 13 types and
53 values**. Tiers A and B inherit that blind spot, and these are symbols Macro relies on.
The recorder index (`fixtures/index.json`) re-derives this list on every run: a P0 MODEL or
BRIDGE symbol that no fixture calls must appear below or in the matrix with a test id, or
`just lexical-coverage --check` fails.

Values with model semantics get an A-hand test (expected values from an upstream run, via a
throwaway upstream vitest file whose assertions are pasted into the PR) or a Tier C command
(§3.2):

| Symbol (Macro files) | Test id | Tier |
| --- | --- | --- |
| `@lexical/utils` `$findMatchingParent` (19), `lexical` `$findMatchingParent` (8) | `hand::utils_gaps::find_matching_parent_returns_nearest_matching_ancestor`, `…_includes_start_node`, `…_returns_none_past_root` | A-hand |
| `$dfsIterator` (12) | `hand::utils_gaps::dfs_iterator_yields_depth_and_node_in_preorder`, `…_stops_at_end_node` | A-hand |
| `$wrapNodeInElement` (6) | `hand::utils_gaps::wrap_node_in_element_replaces_node_and_appends_it` | A-hand |
| `$unwrapNode` (4) | `hand::utils_gaps::unwrap_node_moves_children_before_and_removes` | A-hand |
| `$getTableNodeFromLexicalNodeOrThrow` (6), `$getTableCellNodeFromLexicalNode` (5) | `hand::table_gaps::get_table_node_from_cell_text`, `…_throws_outside_table` (upstream message), `get_table_cell_from_nested_paragraph` | A-hand |
| `$computeTableMap` (3) | `hand::table_gaps::compute_table_map_with_row_and_col_spans` (a 3×3 with a 2×2 merge; the full map literal) | A-hand |
| `$insertTableRowAtSelection` (3) | `hand::table_gaps::insert_row_after_with_colspan_crossing`, `…_before_first_row` | A-hand + Tier C `InsertRow` |
| `$deleteTableColumnAtSelection` (2) | `hand::table_gaps::delete_column_trims_colspan`, `…_last_column_removes_table` | A-hand + Tier C `DeleteColumn` |
| `$unmergeCell` (3), `registerTableCellUnmergeTransform` (1) | `hand::table_gaps::unmerge_cell_restores_grid`, `unmerge_transform_splits_spanned_cell_on_import` | A-hand + Tier C `UnmergeCell` |
| (audit-r1-B F2a-1) two span-changing ops in one transaction | `hand::table_gaps::merge_then_insert_row_in_one_update_matches_snapshot_rule`: records the deliberate deviation of S3 1b.3 for the "already writable" case, with the JS result in a comment and the S3 rule asserted | A-hand (`divergence-<n>`) |
| `$generateJSONFromSelectedNodes` (3), `$generateNodesFromSerializedNodes` (3) | `hand::clipboard_gaps::generate_json_from_partial_text_selection`, `…_hoists_extract_with_child`, `…_skips_exclude_from_copy_html_quirk`, `generate_nodes_from_serialized_assigns_fresh_keys` | A-hand + Tier C `Copy` |
| `$getMarkIDs` (1) | `hand::mark_gaps::get_mark_ids_on_text_inside_nested_marks`, `…_at_mark_boundary_offset` | A-hand |
| `$ensureForwardRangeSelection` (1) | `hand::selection_gaps::ensure_forward_swaps_backward_selection` | A-hand |
| `$normalizeCaret` (1), `$createPoint` (1), `$getPreviousSelection` (1), `$normalizeSelection__EXPERIMENTAL` (1) | `hand::lexical_gaps::normalize_caret_descends_into_text`, `create_point_is_detached`, `previous_selection_is_last_committed`, `normalize_selection_experimental_matches_normalize_selection` | A-hand |
| `isCurrentlyReadOnlyMode` (1) (S1 §17: n/a in Rust, G-11) | `view_gaps.test.ts::isCurrentlyReadOnlyMode true inside editor.read, false inside editor.update` | shim |
| `SKIP_SELECTION_FOCUS_TAG` (1) | `hand::commit::skip_selection_focus_tag_suppresses_set_view_selection` | A-hand |
| `ORDERED_LIST` (2), `TEXT_FORMAT_TRANSFORMERS` (1) (`@lexical/markdown`) | `hand::markdown_gaps::ordered_list_import_keeps_start_number`, `…_export_renumbers`, `text_format_transformers_alone_export_bold_italic` | A-hand |
| `getCodeLanguages` (1) (S3 §1c.1.7: not ported, G-11) | `view_gaps.test.ts::getCodeLanguages equals the upstream list` (literal list recorded from upstream) | shim |
| `KEY_BACKSPACE_COMMAND` (8), `KEY_DELETE_COMMAND` (3), `KEY_DOWN_COMMAND` (4), `KEY_ESCAPE_COMMAND` (14), `DELETE_WORD_COMMAND` (2), `DELETE_LINE_COMMAND` (2) | Tier C `KeyBackspace`, `KeyDelete`, `KeyArrow{Down}`, `KeyEscape`, `DeleteWord`, `DeleteLine` (§3.2, dispatched through the command bus, D2); e2e E24 | C + e2e |
| `CLEAR_EDITOR_COMMAND` (1) | `hand::commands_gaps::clear_editor_leaves_one_empty_paragraph` (XB-04, audit-r1-B C-6), Tier C `ClearEditor` | A-hand + C |
| `INSERT_ORDERED_LIST_COMMAND` (2), `INSERT_CHECK_LIST_COMMAND` (2), and the other package commands of G-5 (`INSERT_UNORDERED_LIST_COMMAND`, `REMOVE_LIST_COMMAND`, `UPDATE_LIST_START_COMMAND`, `TOGGLE_LINK_COMMAND`, `INSERT_TABLE_COMMAND`) | `hand::commands_gaps::package_command_keys_dispatch_to_mapped_handlers` (one literal case per key: dispatch the S3 `static CommandKey` through `Input::Command` and assert the handler's state) + Tier C `InsertList(number\|check)` via `dispatch`, not `$insertList` | A-hand + C |
| `PASTE_COMMAND` (5), `SELECTION_CHANGE_COMMAND` (6) | Tier C `PasteNodes` dispatches `PASTE_COMMAND` with a model payload; `SelectionFromView` asserts `Effect::SelectionChange` against U's listener | C |
| `registerPlainText` (2) (audit-r1-B C-2) | `hand::plain_text::insert_paragraph_inserts_line_break` (PT-05) first, then one test per PT-01..PT-16 | A-hand |
| `registerTableSelectionObserver` (1) | model half: `hand::table_gaps::observer_selection_follows_cell_range` (TBL-OBS); DOM half Tier B view | A-hand + B |

Values with no model semantics are covered where they live: `getNearestEditorFromDOMNode`,
`$updateDOMSelection`, `getDOMCellFromTarget`, `getTableObserverFromTableElement`,
`getTableElement`, `setScrollableTablesActive`, `createDOMRange`, `createRectsFromDOMRange`,
`calculateZoomLevel`, `stopLexicalPropagation`, `DRAG_DROP_PASTE`, `DRAGOVER_COMMAND`,
`DROP_COMMAND`, `BLUR_COMMAND`, `FOCUS_COMMAND` → the shim's own view tests
(`lexical-wasm-shim/src/__tests__/view_gaps.test.ts`, one literal test each) and e2e E24 (drag, focus and blur paths) and E3 (paste).

The 13 types (`SerializedEditorState`, `DOMConversionMap`, `DOMConversion`, `DOMExportOutput`,
`TextFormatTransformer`, `SerializedCodeNode`, `SerializedMarkNode`, `HeadingTagType`,
`SerializedListNode`, `ElementFormatType`, `TableDOMCell`, `UpdateListener`,
`CommandListener`) are checked by `lexical-wasm-shim/src/__tests__/types.test-d.ts`:
`expectTypeOf<shim.X>().toEqualTypeOf<upstream.X>()` per type, run by `vitest typecheck`.

The first test of `tests/hand/utils_gaps.rs`, written out in full:

```rust
/// upstream: no upstream test names `$findMatchingParent`; expected value from running
/// `$findMatchingParent(text, $isListItemNode)` on upstream v0.45.0 with this tree.
/// covers: S2:@lexical/utils:$findMatchingParent, UTL-07
#[test]
fn find_matching_parent_returns_nearest_matching_ancestor() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).node::<ListNode>().node::<ListItemNode>().build()?;
    let mut tx = editor.transaction();
    let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
    let outer_item = create_list_item_node(&mut tx, None);
    let inner_list = tx.create(ListNode::new(ListType::Bullet, 1))?;
    let inner_item = create_list_item_node(&mut tx, None);
    let text = tx.create_text("deep")?;
    tx.append(inner_item, &[text.key()])?;
    tx.append(inner_list, &[inner_item.key()])?;
    tx.append(outer_item, &[inner_list.key()])?;
    tx.append(list, &[outer_item.key()])?;
    let root = tx.root();
    tx.append(root, &[list.key()])?;

    let found = tx.find_matching_parent(text, |state, key| state.is::<ListItemNode>(key));

    assert_eq!(found, Some(inner_item.key()));
    Ok(())
}
```

### 1.8b Macro-model gap tests (audit-r1-B)

In `crates/client/lexical/macro_document_model/tests/`, one sibling file per area. Each
expected value comes from running the same input through today's lexical-core or
lexical-service code.

| Finding | Test id | What it pins |
| --- | --- | --- |
| F2b-8 / P3-1: the gate's registry | `gate::registry_equals_lexical_service_create_editor` | the Rust gate's and the doc-id routes' registry type list equals `Object.keys(createEditor()._nodes)` from `services/lexical-service/src/lib/editor.ts` (recorded into the test as a literal list), with **no** replacements; and `headless_editor()` (composers, snapshots) equals `SupportedNodeTypes + NodeReplacements`, also a recorded literal |
| F2b-8 | `gate::code_rewritten_as_custom_code_with_same_text_is_not_comment_only`, `gate::language_change_on_code_is_not_comment_only`, `gate::list_rewritten_as_task_list_is_not_comment_only` | the fail-open case: JS says false, Rust must too |
| F2b-9 | `gate::comment_inside_checked_false_bullet_item` | node-intrinsic transforms run during the gate as upstream; verdict and normalized JSON equal JS |
| F2b-10 | `gate::left_neighbour_without_state_merges_into_right` | the asymmetric `$canSimpleTextNodesBeMerged` predicate |
| gate source | `gate::identity_state_keys_are_stripped` | `id`, `peerId`, `sharedPeerIds`, `local` stripped exactly as `IDENTITY_STATE_KEYS` (`lib/comment-only-change.ts:17`) |
| gate source | `gate::key_order_does_not_change_verdict` | `isDeepStrictEqual` ignores key order: permuted keys give the same verdict |
| F2b-16 | `node_ids::two_duplicates_pasted_in_one_update_winner` | which node keeps the id under upstream transform order |
| F2b-13 (nodeId root) | `node_ids::root_has_no_id_after_an_edit` | `RootNode` is not in `SupportedNodeTypes` |
| F2b-18 | `loro_snapshot::delete_first_then_swap_second_and_third` | Rust applies moves against post-deletion indices (S3 fix) |
| F2b-4 | `rich_nodes::code::home_end_in_paragraph_is_not_handled` | the code Home/End guard |
| P3-4 | one `nodes::<node>_absent_field_round_trips_absent` per field in the P3-4 list | absent in, absent out |
| P3-5 | `nodes::snapshot_missing_date_is_stamped_with_injected_clock`, `…_empty_string_date_is_stamped` | stamp, not error |
| P3-6 | `nodes::magic_chip_channel_id_null_round_trips_null`, `nodes::agent_activity_row_card_null_round_trips` | null survives |
| Q18 | `json::integer_like_keys_hoist_first_in_pass_through_objects` | JS own-property order (`{"b":1,"2":0,"a":1,"1":0}` → `{"1":0,"2":0,"b":1,"a":1}`) |
| R-2 / Q7 | `html::equation_btoa_latin1_when_all_units_le_ff`, `…_utf8_otherwise` | byte-identical with `btoa` where JS has output |
| R-3 / Q22 | `html::html_render_unbalanced_div_is_balanced`, `…_template_close_cannot_break_out` | parse-and-serialize in production |
| R-4 / Q6 | `nodes::custom_code_language_normalized_on_first_writable_clone` | `"js"` stays until the first structural edit, then `"javascript"` |
| R-6 / Q9 | `nodes::booking_link_url_uses_passed_host`, `…_headless_when_host_none` | |
| Q3 / Q20 | `nodes::document_mention_created_at_from_injected_clock` | stamp kept, clock injected |
| Q1 | `html::list_markdown_renders` | the intended output, since JS throws today (the JS fix lands first, §3.6) |
| Q11 | `json::unknown_node_round_trips_verbatim_in_model` (builder with `opaque_unknown_types(true)`, as a collaborative session builds it), `routes::unknown_node_errors_like_js` (`export_registry()`/`headless_editor()`, option off) | S1 D-23 ruling |
| R-5 | ledger entry `lone-surrogate` + `corpus::scan_for_lone_surrogate_escapes` (counts only) | known deviation, measured |
| F2b-14 | `peer::peer_id_plugin_initializes_existing_nodes_on_register` | the mutation listener's initialization pass |
| F2b-15 | `peer::empty_string_peer_id_is_treated_as_none` (one test per truthiness site listed in F2b-15) | JS falsy-string semantics |
| F2b-17 | `loro_snapshot::non_schema_object_added_to_existing_map_becomes_container` | container inference matches loro-mirror on live diffs |
| F2b-23 / A-12 | `shadow::skips_legacy_agent_context_bodies` | S3 R1 kept the cut ("Cut kept"): legacy bodies are skipped and counted by the shadow differ and the corpus, never compared |
| S3 §4.1b open item 3 (strict `MagicChipNode.status`, dropped `ReplyTargetNode.parent` keys) | `corpus::scan_magic_chip_status`, `corpus::scan_reply_target_parent_keys` (counts only, no content) + ledger `divergence-<n>` | S4 owns the corpus scan; default: the divergence is kept and measured (audit-r2-2 §5 item 7) |
| `WatermarkNode` `removable() == false` (S3 CR-1) | `nodes::watermark_remove_is_noop` | `remove()` on a watermark leaves the tree unchanged, as upstream |
| P3-14 / P3-15 | `composers::image_markdown_static_file_id_emitted_unchanged`, `…_url_trimmed_for_validation_only` | |
| C-7 | Tier C `DropMove` (§3.2) + e2e E24 drag-reorder | rich-text drop of a Lexical drag moves, not copies |
| every other F2a-/F2b- finding | the S3 fix lands with one literal test whose `covers:` names the finding (`covers: S3:F2a-6`) | `lexical-coverage --check` lists audit-r1-B findings with no test |

### 1.8c AMBIGUOUS behaviours (A5)

Every S2 item flagged **AMBIGUOUS** (74 inline flags plus S2 §5; the matrix counts them)
gets one literal A-hand test that pins upstream's actual output, in the package's hand
file, named `ambiguous_<s2 id>` (for example `hand::markdown::ambiguous_md_list_04_x_upper_imports_unchecked`).
Where the port deliberately diverges, the test asserts the Rust behaviour, keeps the
upstream output in a comment, and is ledgered as `divergence-<n>` with a link to the
decision. An AMBIGUOUS id with neither is a `lexical-coverage --check` failure.

### 1.8d Recorder self-tests (B1–B4, B7)

`packages/lexical-conformance/record/__tests__/membrane.test.ts`, run by
`just lexical-fixtures --check`. One literal test per case; each asserts the exact fixture
JSON the recorder writes for a tiny upstream scenario:

1. **listener-enqueued shortcut** (B1): an editor with `registerMarkdownShortcuts`; the
   test types `# ` through `editor.update`. The fixture contains the test's `insertText`
   only; the shortcut's `$createHeadingNode`/`replace` calls are absent; the second
   update has `cause: "listener-enqueued"`; the self-replay passes.
2. **update closure** (B2): calls inside `editor.update(fn)` land in that op's `calls[]`.
3. **tape predicate that calls back** (B2): `$findMatchingParent(n, (x) => $isListItemNode(x))`
   with a predicate that also reads `x.getType()`; the read is in
   `tapes[0].invocations[k].calls`, and the outer trace has exactly one call.
4. **nested update** (B2): `editor.update` inside an update closure becomes its own op with
   `parent`.
5. **container identity** (B3): `$getRoot().getChildren()[0]` is `toBe` the node from
   `$getNodeByKey`; the transparency check passes.
6. **stale handle** (B4): hold a text node, `getWritable()` it in the next update, read
   `__text` from the old reference; the fixture has two handles for one key with
   different `ver`, and the Rust replay (`tests/replay.rs`, same fixture) returns the old
   text.
7. **error capture** (B7): an update that throws inside a transform with a test-supplied
   `onError`; the fixture has an `error` op with `during: "update"`.
8. **un-taped entropy** (B9): a test that calls `Math.random()` from package code without the
   tape fails recording with `untaped-entropy`.

### 1.8e Regression tests for the audit-r2-1 divergences

Each fresh divergence that `audit-r2-1.md` found in S1/S3 R1 gets one regression test, written
before the S1/S3 R2 fix lands (red on the R1 text's behaviour, green on the fix). The expected
values come from upstream v0.45.0 as §1.8 requires; where S1/S3 R2 keep a deliberate divergence
(D-24, and D-25 for R2-26), the test asserts the Rust behaviour, keeps the upstream output in a comment,
and the ledger carries `divergence-<n>`. R2-38…R2-58 are API-shape findings: their "test" is a
compile-and-run test in `tests/api_shape.rs` that uses the exact signature (a signature that
does not compile fails the test build), plus a runtime assertion where the finding has one. Each
test carries `covers: S1:R2-nn` (S3 findings use the same prefix; the id is the audit's).

| Finding | Test id | Tier | Crate |
| --- | --- | --- | --- |
| R2-01 full-reconcile diff prunes shared-`Arc` subtrees | `hand::commit::undo_of_one_char_reports_one_updated_text_mutation` (type one char, undo: exactly one `Updated` mutation and one TEXT op) | A-hand + C (commit compare, §3.3) | lexical_model |
| R2-02 `set_editor_state` runs a flush | `hand::history::root_transform_does_not_run_on_restored_state`, `hand::history::write_after_set_editor_state_is_an_error` | A-hand | lexical_model |
| R2-03 text-format sync on created elements | `hand::commit::created_paragraph_keeps_given_text_format` (ViewAttached; Enter at the end of bold text) | A-hand | lexical_model |
| R2-04 `NodeState::equivalent` and unknown entries | `hand::node_state::unknown_object_entries_compare_by_identity` | A-hand | lexical_model |
| R2-05 default `import` passes the parsed struct to `with` | `hand::json::import_passes_default_original_to_replacement_with` | A-hand | lexical_model |
| R2-06 absent `mode` is not simple text | `hand::normalization::text_without_mode_does_not_merge` | A-hand | lexical_model |
| R2-07 `InsertClipboardNodes` drops the selection | `hand::clipboard_gaps::insert_generated_nodes_passes_selection_to_table_handler` | A-hand | lexical_rich_nodes |
| R2-08 `patch_style_text`/`escape_formats_for_trigger` on the active selection | `rich_nodes::selection::patch_style_text_on_active_selection_remaps_split_points`, `macro_document_model::composers::escape_formats_for_trigger_on_active_selection` | A-hand | lexical_rich_nodes |
| R2-09 `$applyIdFromSerialized` residue | `node_ids::id_only_import_keeps_stored_id_on_diff_and_search_match_nodes` | A-hand | macro_document_model |
| R2-10 rule-5 clean-up applies to `Full` | `node_ids::full_import_keeps_non_string_id_values` | A-hand | macro_document_model |
| R2-11 plain-text SELECT_ALL and CONTROLLED_TEXT_INSERTION | `hand::plain_text::select_all_with_no_selection_selects_root`, `hand::plain_text::controlled_text_insertion_event_with_data_transfer_inserts_payload` | A-hand | lexical_rich_nodes |
| R2-12 pre-R1 leftovers | `gate::left_neighbour_without_state_merges_into_right` (asymmetric predicate, existing), `rich_nodes::utils::is_block_false_for_shadow_root`, `hand::table_gaps::insert_column_reads_live_col_span`, `api_shape::rich_nodes_module_paths` (the phantom crate paths resolve) | A-hand + compile | lexical_rich_nodes |
| R2-13 `patch_style_text` double patch | `rich_nodes::selection::compute_patch_runs_twice_on_empty_anchor_element` | A-hand | lexical_rich_nodes |
| R2-14 `update_selection_on_insert` scan | `hand::clipboard_gaps::update_selection_on_insert_stops_at_non_inline_element` | A-hand | lexical_rich_nodes |
| R2-15 S3 hook impls use pre-R1 signatures | `api_shape::s3_impl_blocks_compile_against_s1_traits` (every S3 `impl … for` block, extracted from the spec by `just lexical-spec-snippets`, compiled in `lexical_conformance`'s `tests/s3_impls/`), `rich_nodes::hooks::decorator_exclude_from_copy_is_never_called` | compile + A-hand | lexical_rich_nodes |
| R2-16 TableRow `height: null`, fractional/negative spans | `rich_nodes::table::row_height_null_round_trips_null`, `rich_nodes::table::cell_negative_and_fractional_spans_round_trip` | A-hand | lexical_rich_nodes |
| R2-17 EditorCore applies the view selection with no listener | `hand::core::unhandled_command_commits_nothing` | A-hand | lexical_model |
| R2-18 composition key staged in the transaction | `hand::core::composition_key_rolls_back_on_err` (D-16, `divergence-<n>`); the Tier C comparator masks the composition key after an `Err` (§3.3) | A-hand + C | lexical_model |
| R2-19 `$selectAll` inside a table cell | `hand::selection_gaps::select_all_inside_table_cell_selects_root` | A-hand | lexical_model |
| R2-20 `insertNodes` CASE 1 (code block) | `hand::selection_gaps::insert_nodes_into_code_block_splices_at_split`, `hand::selection_gaps::insert_code_into_code_inserts_text` | A-hand | lexical_rich_nodes |
| R2-21 `deleteWord`/`deleteLine` need two targets | `hand::selection_gaps::delete_word_collapsed_after_word_extend_uses_character_target` (EditorCore input with both targets) | A-hand + C `DeleteWord` | lexical_model |
| R2-22 caret cursors are one step eager | `hand::caret::cursor_is_one_step_eager_after_removing_origin` | A-hand | lexical_model |
| R2-23 history skips on identity | `hand::history::type_undo_type_within_delay_then_undo_restores_post_undo_state` | A-hand + C `Undo`/`Tick` | lexical_model |
| R2-24 `HISTORY_PUSH` scope | `hand::history::history_push_keeps_no_dirty_merge_and_composing_discard` | A-hand | lexical_model |
| R2-25 `$insertNodes` on the previous selection | `hand::selection_gaps::insert_nodes_on_previous_selection_leaves_it_unadjusted` | A-hand | lexical_model |
| R2-26 `NodeSelection.deleteNodes` identity test | `hand::selection_gaps::node_selection_delete_relocates_previous_selection` (asserts S1 §19.2 D-25: relocation only for `Active`, `divergence-<n>`) | A-hand | lexical_model |
| R2-27 `$removeNode` empty-parent cascade | `hand::lexical_gaps::remove_cascade_bypasses_parent_remove_override` | A-hand | lexical_model |
| R2-28 transform loop reads the composition key once | `hand::transforms::composition_key_read_once_per_loop` | A-hand | lexical_model |
| R2-29 `normalize_range_selection` on a live selection | `hand::selection_gaps::select_all_normalization_moves_composition_key` | A-hand | lexical_model |
| R2-30 `top_level_element` error condition | `hand::lexical_gaps::top_level_element_accepts_inline_element_at_root` | A-hand | lexical_model |
| R2-31 `insert_node_to_nearest_root` empty `get_nodes` | `rich_nodes::utils::insert_node_to_nearest_root_empty_selection_appends_paragraph` | A-hand | lexical_rich_nodes |
| R2-32 `slice_selected_text_node_content` guards | `rich_nodes::selection::slice_selected_text_node_content_returns_full_text_for_token_node` | A-hand | lexical_rich_nodes |
| R2-33 style value boundary exclusion | `rich_nodes::selection::style_value_for_node_selection_folds_every_text_node` | A-hand | lexical_rich_nodes |
| R2-34 `unmerge_cell_node` header bits | `hand::table_gaps::unmerge_cell_header_bits_follow_upstream_insert_order` | A-hand | lexical_rich_nodes |
| R2-35 `ListItemNode::collapse_at_start` nested branch | `hand::list::collapse_at_start_nested_drops_item_content` | A-hand | lexical_rich_nodes |
| R2-36 `trim_text_content_from_anchor` re-reads the anchor | `rich_nodes::selection::trim_text_content_rereads_anchor_after_remove` | A-hand | lexical_rich_nodes |
| R2-37 `backspace_action` ko-KR order | `rich_nodes::rich_text::backspace_outdents_indented_block_before_ko_kr_bailout` | A-hand | lexical_rich_nodes |
| R2-38 `Parent: ElementNode` supertrait | `api_shape::kind_trait_supertraits_compile` | compile | lexical_model |
| R2-39 `Read` defaults returning borrows | `api_shape::read_defaults_return_borrows_from_the_view` | compile | lexical_model |
| R2-40 `EditorState` methods shadow `Read` | `api_shape::editor_state_is_empty_and_read_is_empty_both_callable` | compile | lexical_model |
| R2-41 erased traits lack `Send + Sync` | `api_shape::editor_state_editor_and_core_are_send_and_sync` | compile | lexical_model |
| R2-42 `node_trait` storage read back by `get_dyn` | `api_shape::node_trait_round_trips_through_get_dyn` | compile + A-hand | lexical_model |
| R2-43 `default_data` needs specialization | `api_shape::default_data_for_non_default_node_is_none` | compile + A-hand | lexical_model |
| R2-44 `Error::Invariant(&'static str)` | `api_shape::invariant_error_carries_formatted_upstream_message` | compile + A-hand | lexical_model |
| R2-45 S3 `Error` variants missing from S1 | `api_shape::s3_error_variants_exist` | compile | lexical_rich_nodes |
| R2-46 duplicate `CopyDestination` | `api_shape::copy_destination_has_one_definition` | compile | lexical_html |
| R2-47 S3 callbacks take `&EditorState` | `api_shape::s3_callbacks_callable_inside_a_transaction` | compile | lexical_rich_nodes |
| R2-48 NodeId/PeerId `after_commit` under `EditorCore` | `node_ids::node_created_in_apply_gets_an_id_in_the_same_output` (S1 §14.2 `Plugin::after_commit`: one follow-up per round shared by every plugin, audit-r2-4 H5) | A-hand | macro_document_model |
| R2-49 `selection_transform` aliases `&mut tx` | `api_shape::selection_transform_previous_is_owned` | compile | lexical_model |
| R2-50 `StateKey::with_is_equal` const fn | `api_shape::state_key_with_is_equal_in_a_static` | compile | lexical_model |
| R2-51 no mutable projection for `get_mut::<Ancestor>` | `api_shape::get_mut_projects_to_a_declared_ancestor` | compile + A-hand | lexical_model |
| R2-52 `TableSelectionExt::insert_nodes` borrows, `as_table` missing | `api_shape::table_selection_insert_nodes_and_as_table` | compile | lexical_rich_nodes |
| R2-53 S3 stores closures | `api_shape::s3_config_types_hold_fn_pointers` (asserts `Copy` on the config types) | compile | lexical_rich_nodes |
| R2-54 `_at` naming of slot setters | `api_shape::slot_setters_are_named_at` (lists every `SelectionSlot`-taking setter through rustdoc JSON) | compile | lexical_model |
| R2-55 `NodeKey::from_parts` argument order | `api_shape::node_key_from_parts_matches_ord` | compile + A-hand | lexical_model |
| R2-56 record `Node` vs generic `Node` | `api_shape::record_type_does_not_collide_with_node_trait` | compile | lexical_model |
| R2-57 style types inconsistent | `api_shape::style_is_one_type_on_selection_props_and_nodes` | compile | lexical_model |
| R2-58 `Input`/`Output` derive `Clone`, `Debug` (`Input` also `PartialEq`), no wire derives | `api_shape::input_output_derive_debug_clone` (compile); the wire round trip is `session_bop::input_output_round_trip` in S7's crate (bebop `session.bop`; `lexical_model` has no wire derives, S1 §11.4, F18) | compile + A-hand | lexical_model |

### 1.8f R2 symbol gap tests (audit-r2-2 G-7, G-11, §4)

These override §1.8a for the generator. Rust ports that no upstream suite reaches through Rust
(G-7) get a literal Rust test; Macro-used VIEW names and the P0 names that are `js-by-design`
(§2.2) get one literal shim test each in `packages/lexical-wasm-shim/src/__tests__/view_gaps.test.ts`.

| Symbol | Test id | Tier |
| --- | --- | --- |
| `$getClipboardDataFromSelection` | `hand::clipboard_gaps::clipboard_data_from_selection_has_lexical_json_and_text_keys` | A-hand + C `Copy` |
| `$insertDataTransferForRichText` | `hand::clipboard_gaps::insert_data_transfer_rich_text_prefers_lexical_json_then_text` (HTML part: Tier B, JS import) | A-hand + C `PasteNodes` |
| `$handleRichTextDrop` | `hand::clipboard_gaps::rich_text_drop_of_a_lexical_drag_moves` | A-hand + C `DropMove` |
| `$insertDataTransferForPlainText` | `hand::plain_text::insert_data_transfer_plain_text_inserts_text_payload` | A-hand |
| `$writeDragSourceToDataTransfer` | `hand::clipboard_gaps::write_drag_source_sets_lexical_json` | A-hand |
| `$createOverflowNode`, `$isOverflowNode` | `hand::overflow::create_overflow_node_is_inline_and_detected` | A-hand |
| `$rootTextContent` | `hand::text::root_text_content_joins_blocks_with_two_newlines` | A-hand |
| `$getNearestNodeFromDOMNode` | `view_gaps.test.ts::$getNearestNodeFromDOMNode resolves text, decorator child and root` + e2e E24 (click into a mention) | shim + e2e |
| `getDOMSelection` | `view_gaps.test.ts::getDOMSelection returns the window selection` | shim |
| `isHTMLElement` | `view_gaps.test.ts::isHTMLElement` | shim |
| `setDOMUnmanaged` | `view_gaps.test.ts::setDOMUnmanaged children survive reconcile` | shim |
| `IS_APPLE`, `IS_IOS` | `view_gaps.test.ts::platform flags equal upstream for the jsdom UA` | shim |
| `stopLexicalPropagation`, `$updateDOMSelection`, `getNearestEditorFromDOMNode` | `view_gaps.test.ts::{name}` | shim |
| `BLUR_COMMAND`, `FOCUS_COMMAND`, `CLICK_COMMAND`, `CUT_COMMAND`, `DRAGOVER_COMMAND`, `DROP_COMMAND`, `DRAG_DROP_PASTE` | `view_gaps.test.ts::{name} dispatched from its DOM event` + e2e E24 | shim + e2e |
| `$getEditor`, `mergeRegister` | `view_gaps.test.ts::{name}` | shim |
| `createDOMRange`, `createRectsFromDOMRange`, `setScrollableTablesActive`, `getDOMCellFromTarget`, `getTableElement`, `getTableObserverFromTableElement`, `calculateZoomLevel` | `view_gaps.test.ts::{name}` | shim |
| `NormalizeTripleClickSelectionExtension` (R2.1, S1 §14.4: model `Transaction::fix_focus_overselection`, plugin S3 `lexical_rich_nodes::normalize_triple_click`, view web-view) | `hand::selection_gaps::fix_focus_overselection_matches_normalize_triple_click_extension` (upstream's `NormalizeTripleClickSelectionExtension` cases, driven by `SelectionChangeContext::triple_click`) | A-hand |
| `ClickAfterLastBlockExtension` (R2.1, S1 §14.4: model S3 `lexical_rich_nodes::click_after_last_block`, hit test web-view) | `rich_nodes::click_after_last_block::insert_after_last_block_appends_paragraph_after_decorator` | A-hand |

### 1.8g Behaviour-id overrides

Ids whose test already exists under another name. `{id}` is the snake-cased id; a range
`X-01..X-16` expands to every id in it.

| S2 id | Test id | Tier |
| --- | --- | --- |
| PT-01..PT-16 | `hand::plain_text::{id}` (the `fn` name starts with the id) | A-hand |
| PT-05 | `hand::plain_text::insert_paragraph_inserts_line_break` | A-hand |
| XB-04 | `hand::commands_gaps::clear_editor_leaves_one_empty_paragraph` | A-hand + C `ClearEditor` |
| UTL-07 | `hand::utils_gaps::find_matching_parent_returns_nearest_matching_ancestor` | A-hand |
| PATCH-NONE | `macro_profile::no_other_lexical_patches` (lists `apps/web/patches/@lexical*` and asserts exactly the two patches PATCH-TBL and PATCH-MD) | A-hand |

### 1.8h Private surface Macro uses (audit-r2-2 G-9)

Not exports, so S2 cannot list them; the shim must keep them (S12 §2 owns the shim). One literal
test each in `view_gaps.test.ts`, run in both Tier B configs; the generator adds a `priv` row
per field.

| Field | Macro use | Test id |
| --- | --- | --- |
| `editor._config.namespace` | `editing/entityDrop.ts:38` | `view_gaps.test.ts::editor._config.namespace equals createEditor namespace` |
| `editor._nodes.values()…klass` | `plugins/snippets/snippetsPlugin.ts:125`, `plugins/markdown-paste/markdownPastePlugin.ts:21` | `view_gaps.test.ts::editor._nodes klass is the registered class` |
| `editor._commands.has(cmd)` | `plugins/checkbox-to-task/checkboxToTaskPlugin.ts:180` | `view_gaps.test.ts::editor._commands.has after registerCommand` |
| node `__key` | `collaboration/undo.ts`, `collaboration/remote-cursor.tsx` | `view_gaps.test.ts::node.__key equals getKey()` |
| node `__parent` | `packages/lexical-core/nodes/*` | `view_gaps.test.ts::node.__parent equals getParent key` |
| node `__type` | `component/core/StaticMarkdown.tsx` | `view_gaps.test.ts::node.__type equals getType()` |
| node `__text` | `packages/lexical-core/nodes/*` | `view_gaps.test.ts::text.__text equals getTextContent()` |
| node `__format` | `packages/lexical-core/nodes/*` | `view_gaps.test.ts::node.__format equals getFormat()` |
| node `__mode` | `packages/lexical-core/nodes/*` | `view_gaps.test.ts::text.__mode equals the mode code` |

### 1.8i R2.1 core API tests (S1 R2.1)

One literal test per item S1 R2.1 adds to `lexical_model`. They are not matrix rows of their
own: each covers the S1 item named in its `covers:` line (`/// covers: S1:<section>`).

| S1 item | Test id | Tier | Crate |
| --- | --- | --- | --- |
| §3.2, §4.1, §8.5 type table (`Registry::type_table`, `TypeTableRow`, `FLAGS_PER_INSTANCE`) | `hand::registry::type_table_equals_per_instance_flags_for_every_live_node` (the §8.5 debug check, over a document with every built-in and S3 type; per-instance rows carry no flags) | A-hand | lexical_model |
| §4.2 `BuildError::NoFlagProbe` | `hand::registry::type_without_default_node_or_flag_probe_fails_build` | A-hand | lexical_model |
| §14.2 `ListenerTable` / `Editor::listener_table` | `hand::commands::listener_table_reports_highest_priority_per_command`, `hand::commands::foreign_listener_refreshes_listener_table` (feature `foreign-nodes`) | A-hand | lexical_model |
| §15.1 step 4 `SetViewSelection` elision | `hand::core::set_view_selection_elided_when_view_already_matches` | A-hand + C | lexical_model |
| §4.3, §15 `Editor::take_initial_commits`, `EditorCore::take_initial_output` | `hand::core::take_initial_output_returns_build_follow_ups_once` (an `after_commit` plugin over `initial_state`; second call is `None`) | A-hand | lexical_model |
| §5.2 `Read::export_json` vs `export_node` | `hand::json::export_json_has_empty_children_and_export_node_recurses` | A-hand | lexical_model |
| §9.2 `ViewSelection::Table` | `hand::selection_gaps::selection_from_view_table_builds_table_selection` | A-hand + C `SelectionFromView` | lexical_model |
| §9.2 `Transaction::fix_focus_overselection` | §1.8f row `NormalizeTripleClickSelectionExtension` | A-hand | lexical_model |
| §12 `MergeTracker::classify(commit, now)` (no `has_current`) | `hand::history::merge_tracker_classifies_without_history` | A-hand | lexical_model |
| §4.4 `PendingUpdate` staleness | `hand::foreign::resume_after_commit_is_stale_suspended_update` (`Error::StaleSuspendedUpdate`; common native staging tests run without `foreign-nodes`, existing foreign wrappers remain covered) | A-hand | lexical_model |
| §14.2 one shared follow-up per round, 99-round guard | `hand::commands::after_commit_plugins_share_one_follow_up_per_round`, `hand::commands::endless_follow_ups_stop_after_99_rounds` | A-hand | lexical_model |

### 1.9 Enumeration: every unit test file and its tier

Columns:
- **A-rec**: recorded fixture.
- **A-hand**: hand-ported Rust test.
- **B-only**: model behaviour reachable only through events, HTML I/O, internals mocks,
  or the shim's listener layer.
- **view**: asserts DOM or React output.
- **N/A**: runs nowhere in the new tiers and is recorded on the ledger.

Every non-N/A case also runs in Tier B, so "B-only" means "not in Tier A".

**Package totals (upstream, 140 files):**

| Package | Files | Cases | A-rec | A-hand | B-only | view | N/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `lexical` (core) | 37 | 636 | 308 | 50 | 81 | 183 | 14 |
| `lexical-markdown` | 2 | 393 | 385 | 2 | 6 | · | · |
| `lexical-selection` | 3 | 238 | 86 | · | · | 152 | · |
| `lexical-react` | 21 | 126 | 2 | · | 45 | 79 | · |
| `lexical-link` | 5 | 102 | 74 | 1 | 6 | 21 | · |
| `lexical-list` | 8 | 97 | 47 | 4 | 10 | 36 | · |
| `lexical-table` | 9 | 95 | 27 | · | 13 | 55 | · |
| `lexical-code-prism` | 2 | 86 | 84 | · | · | 2 | · |
| `lexical-code-shiki` | 2 | 86 | · | · | 84 | 2 | · |
| `lexical-html` | 9 | 81 | · | · | 63 | 18 | · |
| `lexical-rich-text` | 8 | 65 | 11 | · | 44 | 10 | · |
| `lexical-utils` | 11 | 36 | 26 | · | 2 | 7 | 1 |
| `lexical-playground` | 5 | 28 | 9 | 3 | 16 | · | · |
| `lexical-extension` | 5 | 24 | 2 | · | 16 | 5 | 1 |
| `lexical-code` | 1 | 22 | 3 | · | 4 | 15 | · |
| `lexical-history` | 1 | 18 | 14 | 2 | · | 2 | · |
| `lexical-code-core` | 3 | 16 | 1 | · | 13 | 2 | · |
| `lexical-clipboard` | 2 | 16 | · | · | 16 | · | · |
| `lexical-eslint-plugin` | 2 | 11 | · | · | · | · | 11 |
| `lexical-headless` | 1 | 8 | 4 | 1 | 3 | · | · |
| `lexical-mark` | 1 | 7 | 6 | · | 1 | · | · |
| `lexical-hashtag` | 1 | 1 | 1 | · | · | · | · |
| `lexical-tailwind` | 1 | 1 | · | · | · | 1 | · |
| **total** | **140** | **2,193** | **1,090** | **63** | **423** | **590** | **27** |

Packages with no unit tests (`lexical-text`, `lexical-offset`, `lexical-plain-text`,
`lexical-overflow`, `lexical-file`, `lexical-dragon`, `lexical-devtools*`,
`lexical-internal`, `lexical-yjs`, `lexical-website`) get their Rust coverage from Tier C
and from the A fixtures that use them indirectly. The upstream suites cover `text`
through `useLexicalIsTextContentEmpty`, `offset` not at all, and `plain-text` through
`PlainRichTextPlugin`. `lexical_model` therefore adds a small A-hand file per package
for `lexical-offset` (`OffsetView` round trips with astral text) and `lexical-text`
(`$isRootTextContentEmpty`, `registerLexicalTextEntity`).

Per file. Core paths are relative to `packages/lexical/src/`; package paths to
`packages/<pkg>/src/__tests__/unit/` (mark: `packages/lexical-mark/__tests__/unit/`;
playground: `packages/lexical-playground/__tests__/unit/`):


#### `lexical (core)` (37 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `__tests__/unit/LexicalEditor.test.tsx` | 78 | 13 | 8 | 27 | 30 | · | listener/command timing is shim behaviour (B); `CustomParagraphNode` replacement + transforms hand-ported |
| `nodes/__tests__/unit/LexicalTextNode.test.tsx` | 101 | 70 | 2 | · | 29 | · | split/merge/format/mode tables; createDOM/updateDOM cases are view |
| `__tests__/unit/LexicalNode.test.ts` | 66 | 28 | 7 | 6 | 25 | · | 7 test-defined classes (Custom*/Inline decorator) hand-ported |
| `__tests__/unit/LexicalSelection.test.ts` | 53 | 42 | 1 | 10 | · | · | 10 drive `applyDOMRange`/DOM points |
| `__tests__/unit/LexicalReconciler.test.ts` | 38 | 17 | 6 | · | 15 | · | fast-path suite asserts root text / `__textFormat`, which Rust computes at commit |
| `__tests__/unit/LexicalUtils.test.ts` | 32 | 14 | 10 | 4 | 4 | · | `Extended*Node` replacement chains hand-ported; keyboard predicates B |
| `__tests__/unit/LexicalDOMSlot.test.tsx` | 31 | · | · | · | 31 | · |  |
| `caret/__tests__/unit/LexicalCaret.test.ts` | 54 | 53 | · | · | 1 | · | 28 static, ~54 after DIRECTIONS×BIASES loops |
| `nodes/__tests__/unit/LexicalElementNode.test.tsx` | 25 | 17 | 2 | · | 6 | · | `WrapperElementNode` |
| `__tests__/unit/LexicalNodeState.test.ts` | 18 | 5 | 13 | · | · | · | `createState` parse/unparse are JS callbacks; Rust `StateKey<V>` |
| `nodes/__tests__/unit/LexicalRootNode.test.ts` | 15 | 13 | · | · | 2 | · |  |
| `__tests__/unit/LexicalGenMap.test.ts` | 12 | · | · | · | · | 12 | GenMap is replaced by the persistent map |
| `nodes/__tests__/unit/LexicalTabNode.test.tsx` | 12 | 2 | · | · | 10 | · |  |
| `__tests__/unit/HandleTextDrop.test.ts` | 11 | · | · | 3 | 8 | · | drop events |
| `caret/__tests__/unit/docs-traversals.test.ts` | 8 | 8 | · | · | · | · |  |
| `nodes/__tests__/unit/LexicalParagraphNode.test.ts` | 8 | 4 | · | · | 4 | · |  |
| `__tests__/unit/LexicalExtensionCore.test.ts` | 7 | · | · | 7 | · | · | JS extension-config API shape |
| `__tests__/unit/LexicalEditorListener.test.ts` | 6 | · | · | 6 | · | · | listener layer lives in the shim |
| `__tests__/unit/LexicalUpdateTags.test.ts` | 6 | 5 | 1 | · | · | · | tags are part of the commit snapshot |
| `__tests__/unit/setDOMStyle.test.ts` | 6 | · | · | · | 6 | · |  |
| `nodes/__tests__/unit/LexicalLineBreakNode.test.ts` | 5 | 3 | · | · | 2 | · |  |
| `__tests__/unit/LexicalElementHelpers.test.ts` | 5 | · | · | · | 5 | · |  |
| `__tests__/unit/LexicalIosKoreanIME.test.ts` | 5 | · | · | 5 | · | · | composition event sequences |
| `__tests__/unit/LexicalNormalization.test.tsx` | 5 | 5 | · | · | · | · |  |
| `nodes/__tests__/unit/LexicalGC.test.tsx` | 4 | 4 | · | · | · | · |  |
| `__tests__/unit/LexicalEditorState.test.ts` | 4 | 4 | · | · | · | · |  |
| `__tests__/unit/Issue7729Repro.test.ts` | 4 | · | · | 4 | · | · | HTML round trip |
| `__tests__/unit/LexicalListPlugin.test.tsx` | 3 | · | · | · | 3 | · |  |
| `__tests__/unit/LexicalSelectionResolveLeafPosition.test.ts` | 3 | · | · | 3 | · | · | DOM point resolution |
| `__tests__/unit/FastPathCrossParentTextCache.test.ts` | 2 | · | · | 2 | · | · | reconciler text cache internals |
| `__tests__/unit/HTMLCopyAndPaste.test.ts` | 2 | · | · | 2 | · | · |  |
| `__tests__/unit/mergeRegister.test.ts` | 2 | · | · | · | · | 2 | JS teardown utility |
| `__tests__/unit/CodeBlock.test.ts` | 1 | · | · | · | 1 | · |  |
| `__tests__/unit/FastPathCrossParent.test.ts` | 1 | · | · | 1 | · | · |  |
| `__tests__/unit/Issue8563Repro.test.ts` | 1 | · | · | · | 1 | · |  |
| `__tests__/unit/LexicalReconcilerStaleDecorator.test.ts` | 1 | · | · | 1 | · | · |  |
| `__tests__/unit/LexicalSerialization.test.ts` | 1 | 1 | · | · | · | · |  |
| **total** | **636** | **308** | **50** | **81** | **183** | **14** | |

#### `lexical-markdown` (2 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalMarkdown.test.ts` | 383 | 375 | 2 | 6 | · | · | 111-row table → 108 import + 85 export + 108 no-select = 301, all re-recorded as md↔JSON; export rows start from the recorded post-HTML-import state |
| `MarkdownTransformers.test.ts` | 10 | 10 | · | · | · | · |  |
| **total** | **393** | **385** | **2** | **6** | **0** | **0** | |

#### `lexical-table` (9 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalTableNode.test.tsx` | 38 | 2 | · | 6 | 30 | · | 20 static ×2 `hasHorizontalScroll`; paste cases B |
| `LexicalTableExtension.test.ts` | 15 | 6 | · | 3 | 6 | · |  |
| `LexicalTableCellNode.test.ts` | 13 | 1 | · | · | 12 | · |  |
| `LexicalTableUtils.test.ts` | 12 | 12 | · | · | · | · | calls only `$moveTableColumn`, `$createTestTable`, `$getTableCellTexts`; the table ops Macro uses have **no** upstream fixture and are covered by §1.8a (A3 correction) |
| `LexicalTableMobileSelection.test.tsx` | 6 | · | · | · | 6 | · |  |
| `TableImportExtension.test.ts` | 4 | · | · | 4 | · | · | HTML import (D4) |
| `LexicalTableSelection.test.tsx` | 3 | 3 | · | · | · | · |  |
| `LexicalTablePlugin.test.tsx` | 2 | 2 | · | · | · | · |  |
| `LexicalTableRowNode.test.ts` | 2 | 1 | · | · | 1 | · |  |
| **total** | **95** | **27** | **0** | **13** | **55** | **0** | |

#### `lexical-list` (8 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalListItemNode.test.ts` | 39 | 13 | · | · | 26 | · |  |
| `LexicalListNode.test.ts` | 18 | 11 | 2 | · | 5 | · | `ListNodeSubclass`, `$config` node |
| `formatList.test.ts` | 12 | 10 | 2 | · | · | · | `ExtendedTestList*Node` |
| `utils.test.ts` | 10 | 10 | · | · | · | · |  |
| `ListImportExtension.test.ts` | 10 | · | · | 10 | · | · | HTML import (D4) |
| `ListExtension.test.ts` | 3 | 3 | · | · | · | · |  |
| `checkList.test.tsx` | 4 | · | · | · | 4 | · |  |
| `registerListStrictIndentTransform.test.ts` | 1 | · | · | · | 1 | · |  |
| **total** | **97** | **47** | **4** | **10** | **36** | **0** | |

#### `lexical-link` (5 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalLinkNode.test.ts` | 53 | 40 | · | · | 13 | · | 47 static + 6 via forEach |
| `LexicalAutoLinkNode.test.ts` | 28 | 20 | · | · | 8 | · |  |
| `LinkExtension.test.ts` | 9 | 9 | · | · | · | · |  |
| `LexicalAutoLinkExtension.test.ts` | 6 | 5 | 1 | · | · | · | `ExcludedParentNode`; URL matchers are JS fns → recorded only when they are the stock matchers |
| `LinkImportExtension.test.ts` | 6 | · | · | 6 | · | · | HTML import (D4) |
| **total** | **102** | **74** | **1** | **6** | **21** | **0** | |

#### `lexical-code` (1 file)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalCodeNode.test.ts` | 22 | 3 | · | 4 | 15 | · |  |
| **total** | **22** | **3** | **0** | **4** | **15** | **0** | |

#### `lexical-code-core` (3 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `CodeImportExtension.test.ts` | 10 | · | · | 10 | · | · | HTML import (D4) |
| `CodeExtension.test.ts` | 4 | 1 | · | 3 | · | · |  |
| `CodeNode.test.ts` | 2 | · | · | · | 2 | · |  |
| **total** | **16** | **1** | **0** | **13** | **2** | **0** | |

#### `lexical-code-prism` (2 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalCodeNodeTabs.test.ts` | 84 | 84 | · | · | · | · | 37 scenarios ×2 + 10 outdent; compared as (code text, absolute selection) because highlight nodes are view-only (D6) |
| `CodePrismNullDefaultLanguage.test.ts` | 2 | · | · | · | 2 | · | asserts highlight-node children: view-only under D6 |
| **total** | **86** | **84** | **0** | **0** | **2** | **0** | |

#### `lexical-code-shiki` (2 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalCodeNodeTabs.test.ts` | 84 | · | · | 84 | · | · | same scenarios as prism; Tier A records them once from prism |
| `CodeShikiNullDefaultLanguage.test.ts` | 2 | · | · | · | 2 | · |  |
| **total** | **86** | **0** | **0** | **84** | **2** | **0** | |

#### `lexical-mark` (1 file)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalMarkNode.test.ts` | 7 | 6 | · | 1 | · | · |  |
| **total** | **7** | **6** | **0** | **1** | **0** | **0** | |

#### `lexical-rich-text` (8 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `EscapeFormatTriggers.test.ts` | 17 | · | · | 17 | · | · | dispatched KeyboardEvents |
| `LexicalHeadingNode.test.ts` | 14 | 7 | · | · | 7 | · |  |
| `RichTextInlineDecoratorMoveToEnd.test.ts` | 9 | · | · | 9 | · | · | arrow-key commands |
| `RichTextInlineDecoratorMoveToStart.test.ts` | 8 | · | · | 8 | · | · |  |
| `RichTextImportExtension.test.ts` | 8 | · | · | 8 | · | · | HTML import (D4) |
| `LexicalQuoteNode.test.ts` | 5 | 2 | · | · | 3 | · |  |
| `LexicalTabNode.test.ts` | 2 | 2 | · | · | · | · |  |
| `RichTextNodeSelectionEnter.test.ts` | 2 | · | · | 2 | · | · | KEY_ENTER with a NodeSelection |
| **total** | **65** | **11** | **0** | **44** | **10** | **0** | |

#### `lexical-selection` (3 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalSelection.test.tsx` | 185 | 74 | · | · | 111 | · | block moves 29×2=58 + decorator text 7×2=14 + Node.replace 2 recorded; `suite` (~91) + 19 literal drive native selection |
| `LexicalSelectionHelpers.test.ts` | 49 | 8 | · | · | 41 | · | asserts DOM text nodes |
| `$sliceSelectedTextNodeContent.test.ts` | 4 | 4 | · | · | · | · |  |
| **total** | **238** | **86** | **0** | **0** | **152** | **0** | |

#### `lexical-utils` (11 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalNodeHelpers.test.ts` | 12 | 12 | · | · | · | · |  |
| `iterators.test.tsx` | 7 | 7 | · | · | · | · |  |
| `markSelection.test.tsx` | 4 | · | · | · | 4 | · |  |
| `LexicalEventHelpers.test.tsx` | 3 | · | · | · | 3 | · |  |
| `LexicalRootHelpers.test.ts` | 2 | 2 | · | · | · | · |  |
| `LexicalUtilsSplitNode.test.tsx` | 2 | 1 | · | 1 | · | · |  |
| `unwrapAndFilterDescendants.test.tsx` | 2 | 2 | · | · | · | · | predicate args encoded as `$fn` refs |
| `descendantsMatching.test.tsx` | 1 | 1 | · | · | · | · |  |
| `LexicalUtilsInsertNodeToNearestRootAtCaret.test.ts` | 1 | 1 | · | · | · | · |  |
| `LexicalUtilsInsertNodeToNearestRoot.test.tsx` | 1 | · | · | 1 | · | · |  |
| `LexicalUtilsKlassEqual.test.ts` | 1 | · | · | · | · | 1 | JS class identity |
| **total** | **36** | **26** | **0** | **2** | **7** | **1** | |

#### `lexical-history` (1 file)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalHistory.test.tsx` | 18 | 14 | 2 | · | 2 | · | merge heuristics need a recorded clock (`Date.now`) |
| **total** | **18** | **14** | **2** | **0** | **2** | **0** | |

#### `lexical-html` (9 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `DOMImportExtension.test.ts` | 22 | · | · | 22 | · | · | all HTML I/O (D4: import stays JS) |
| `CoreImportExtension.test.ts` | 15 | · | · | 15 | · | · |  |
| `LexicalHtml.test.ts` | 15 | · | · | 15 | · | · | export half → `lexical_html` goldens via the corpus instead |
| `DOMRenderExtension.test.ts` | 10 | · | · | · | 10 | · |  |
| `DOMPreprocess.test.ts` | 6 | · | · | 6 | · | · |  |
| `DOMRenderConditionalOverrides.test.ts` | 5 | · | · | · | 5 | · |  |
| `compileDOMRenderConfigOverrides.test.ts` | 3 | · | · | · | 3 | · |  |
| `Issue8391WhitespaceAroundUnknownInline.test.ts` | 3 | · | · | 3 | · | · |  |
| `HorizontalRuleImportExtension.test.ts` | 2 | · | · | 2 | · | · |  |
| **total** | **81** | **0** | **0** | **63** | **18** | **0** | |

#### `lexical-clipboard` (2 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `GetClipboardDataExtension.test.ts` | 10 | · | · | 10 | · | · | DataTransfer; the `$generateJSONFromSelectedNodes` payload is covered by Tier C paste |
| `ClipboardImportExtension.test.ts` | 6 | · | · | 6 | · | · |  |
| **total** | **16** | **0** | **0** | **16** | **0** | **0** | |

#### `lexical-headless` (1 file)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalHeadlessEditor.test.ts` | 8 | 4 | 1 | 3 | · | · | `withDOM` HTML cases B |
| **total** | **8** | **4** | **1** | **3** | **0** | **0** | |

#### `lexical-extension` (5 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalBuilder.test.ts` | 8 | · | · | 8 | · | · | JS builder API shape (Rust has its own builder) |
| `NestedEditorExtension.test.ts` | 8 | · | · | 8 | · | · |  |
| `ClickAfterLastBlock.test.ts` | 5 | · | · | · | 5 | · |  |
| `NormalizeInlineElements.test.ts` | 2 | 2 | · | · | · | · |  |
| `deepThemeMergeInPlace.test.ts` | 1 | · | · | · | · | 1 |  |
| **total** | **24** | **2** | **0** | **16** | **5** | **1** | |

#### `lexical-hashtag` (1 file)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalHashtagNode.test.ts` | 1 | 1 | · | · | · | · |  |
| **total** | **1** | **1** | **0** | **0** | **0** | **0** | |

#### `lexical-react` (21 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `Collaboration.test.ts` | 15 | · | · | 15 | · | · | Yjs two-client convergence via `getHTML()` (M/D) |
| `CollaborationWithCollisions.test.ts` | 6 | · | · | 6 | · | · |  |
| `CollaborationSnapshot.test.ts` | 7 | · | · | 7 | · | · |  |
| `LexicalNestedComposer.test.tsx` | 8 | · | · | 8 | · | · | 3 JS classes; exercises ForeignNode inheritance |
| `useLexicalCharacterLimit.test.ts` | 2 | 2 | · | · | · | · | OverflowNode merge + selection |
| `useLexicalIsTextContentEmpty.test.tsx` | 1 | · | · | 1 | · | · |  |
| `ReactExtension.test.tsx` | 2 | · | · | 2 | · | · |  |
| `LexicalExtensionEditorComposer.test.tsx` | 3 | · | · | 2 | 1 | · |  |
| `PlainRichTextPlugin.test.tsx` | 6 | · | · | 4 | 2 | · |  |
| `LexicalMenu.test.tsx` | 17 | · | · | · | 17 | · |  |
| `LexicalContentEditableElement.test.tsx` | 13 | · | · | · | 13 | · |  |
| `useExtensionSignalValue.test.tsx` | 11 | · | · | · | 11 | · |  |
| `ExtensionComponent.test.tsx` | 9 | · | · | · | 9 | · |  |
| `LexicalTypeaheadMenuPlugin.test.tsx` | 8 | · | · | · | 8 | · |  |
| `LexicalNodeMenuPlugin.test.tsx` | 7 | · | · | · | 7 | · |  |
| `LexicalExtensionComposer.test.tsx` | 3 | · | · | · | 3 | · |  |
| `React19.test.tsx` | 2 | · | · | · | 2 | · |  |
| `LexicalComposer.test.tsx` | 2 | · | · | · | 2 | · |  |
| `ReactPluginHostExtension.test.tsx` | 2 | · | · | · | 2 | · |  |
| `useMenuAnchorRef.test.tsx` | 1 | · | · | · | 1 | · |  |
| `LexicalCollaborationPlugin.test.tsx` | 1 | · | · | · | 1 | · |  |
| **total** | **126** | **2** | **0** | **45** | **79** | **0** | |

#### `lexical-playground` (5 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `ToolbarPluginFormatCode.test.ts` | 9 | 9 | · | · | · | · |  |
| `CollapsibleContainerNode.test.ts` | 9 | · | 3 | 6 | · | · | JS playground nodes; transforms hand-port only if Macro keeps a collapsible node |
| `LayoutContainerNode.test.ts` | 5 | · | · | 5 | · | · | HTML |
| `docSerialization.test.ts` | 3 | · | · | 3 | · | · | `@lexical/file` hash round trip, HTML indent |
| `ImageHTML.test.ts` | 2 | · | · | 2 | · | · | nested editor in a node field |
| **total** | **28** | **9** | **3** | **16** | **0** | **0** | |

#### `lexical-tailwind` (1 file)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LexicalTailwind.test.ts` | 1 | · | · | · | 1 | · |  |
| **total** | **1** | **0** | **0** | **0** | **1** | **0** | |

#### `lexical-eslint-plugin` (2 files)

| File | Cases | A-rec | A-hand | B-only | view | N/A | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `rules-of-lexical.test.ts` | 7 | · | · | · | · | 7 |  |
| `buildMatcher.test.ts` | 4 | · | · | · | · | 4 |  |
| **total** | **11** | **0** | **0** | **0** | **0** | **11** | |


#### `packages/lexical-core/tests` (Macro, 46 files)

lexical-core tests are recorded on upstream Lexical with Macro's patched markdown
(indent 2) and `SupportedNodeTypes`. Their oracle is today's production behaviour, which
is what lexical-service serves. Almost all of them are md ↔ JSON ↔ md/XML/string
transformations, so they are the Tier A backbone for M1. The same files also run
unmodified on the shim (§2.3a).


| File | Cases | A-rec | A-hand | B-only | view | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `mentions.test.ts` | 65 | 65 | · | · | · |  |
| `agent-context.test.ts` | 51 | 50 | · | · | 1 | one `exportDOM` case |
| `database-query.test.ts` | 34 | 34 | · | · | · |  |
| `auto-link.test.ts` | 31 | 31 | · | · | · | hand-written URL matcher (`AutoLinkRegExp.exec`) ported as a `Matcher` |
| `internal-transformer-fallbacks.test.ts` | 30 | 30 | · | · | · | expected `console.error` recorded |
| `tables.test.ts` | 26 | 26 | · | · | · |  |
| `notion-markdown.test.ts` | 20 | 20 | · | · | · |  |
| `slack-import-links.test.ts` | 20 | 20 | · | · | · |  |
| `agent-trigger-context.test.ts` | 19 | 19 | · | · | · |  |
| `xml-serialize.test.ts` | 16 | 16 | · | · | · |  |
| `reply-target-node.test.ts` | 14 | 14 | · | · | · |  |
| `channel-mentions.test.ts` | 13 | 12 | · | · | 1 |  |
| `pr-mention.test.ts` | 12 | 12 | · | · | · |  |
| `agent-announcement.test.ts` | 10 | 10 | · | · | · |  |
| `agent-chat-reply.test.ts` | 10 | 10 | · | · | · |  |
| `preserve-lines.test.ts` | 10 | 10 | · | · | · |  |
| `comment-mark-text.test.ts` | 9 | 9 | · | · | · |  |
| `cursor-system-notification.test.ts` | 9 | 9 | · | · | · |  |
| `paste.test.ts` | 9 | 9 | · | · | · |  |
| `agent-session-mention.test.ts` | 8 | 6 | · | 2 | · | 2 HTML round trips |
| `date-mention-import.test.ts` | 8 | 8 | · | · | · |  |
| `html-text-formats.test.ts` | 8 | 8 | · | · | · |  |
| `xml.test.ts` | 8 | 8 | · | · | · |  |
| `classedBlock.test.ts` | 7 | 7 | · | · | · |  |
| `connect-app.test.ts` | 7 | 7 | · | · | · |  |
| `katex.test.ts` | 7 | 7 | · | · | · | lookbehind+lookahead regex (`regress`) |
| `explicit-reply.test.ts` | 6 | 6 | · | · | · |  |
| `form-references.test.ts` | 5 | 5 | · | · | · |  |
| `list-transformers.test.ts` | 5 | 5 | · | · | · | 2-space indent (patch → option) |
| `account-manager-request.test.ts` | 3 | 3 | · | · | · |  |
| `agent-activity-markdown.test.ts` | 3 | 3 | · | · | · |  |
| `document-card-conversion.test.ts` | 3 | 3 | · | · | · |  |
| `list-images.test.ts` | 3 | 3 | · | · | · |  |
| `magic-chip.test.ts` | 3 | 3 | · | · | · |  |
| `mediaWrapperImport.test.ts` | 3 | · | · | 3 | · | `$generateNodesFromDOM` |
| `document-reference-decorator-stability.test.ts` | 3 | · | · | · | 3 | `decorate()` identity |
| `agent-connection-prompt.test.ts` | 2 | 2 | · | · | · |  |
| `comment-mark-identity.test.ts` | 2 | 2 | · | · | · |  |
| `document-mention-without-name.test.ts` | 2 | 2 | · | · | · |  |
| `external-chat-references.test.ts` | 2 | 2 | · | · | · |  |
| `generated-image.test.ts` | 2 | 2 | · | · | · |  |
| `session-decorator-stability.test.ts` | 2 | · | · | · | 2 |  |
| `golden.test.ts` | 1 | 1 | · | · | · | `MARKDOWN_GOLDEN` bytes, replayed against `lexical_loro` |
| `htmlRender.test.ts` | 1 | 1 | · | · | · |  |
| `node-id-plugin.test.ts` | 1 | · | 1 | · | · | nodeIdPlugin = mutation listener + transform; Rust model plugin |
| `routine-mention.test.ts` | 1 | 1 | · | · | · |  |
| **total (46 files)** | **514** | **501** | **1** | **5** | **7** | |


#### `services/lexical-service` (Macro, 9 files, 42 cases)

Recorded on upstream with lexical-service's **own** editor (`lib/editor.ts`:
`createHeadlessEditor({nodes: SupportedNodeTypes})`, no `NodeReplacements`), so the Rust
replay must use the export registry (S3 CR-17), not `headless_editor()`.

| File | Cases | A-rec | Notes |
| --- | ---: | ---: | --- |
| `src/lib/comment-only-change.test.ts` | 12 | 12 | the gate's own suite; every case also seeds the gate fuzzer (§3.6a) |
| `src/endpoints/agent-announcement.test.ts` | 7 | 7 | union dispatch, card `.catch(null)` |
| `src/lib/html.test.ts` | 5 | 5 | recorded after the Q1 JS fix (§3.6) |
| `test/agent-context.test.ts` | 5 | 5 | wire examples |
| `src/endpoints/agent-context.test.ts` | 3 | 3 | route validation |
| `src/endpoints/image-markdown.test.ts` | 3 | 3 | validation (P3-14) |
| `src/endpoints/notion-snapshot.test.ts` | 3 | 3 | snapshot compared as `doc.toJSON()` |
| `src/lib/comment-mark.test.ts` | 2 | 2 | |
| `src/endpoints/extract-reply.test.ts` | 2 | 2 | |
| **total** | **42** | **42** | |

#### `apps/web/.../LexicalMarkdown/**/*.test.ts` (Macro, 67 files, A7)

Classified now, not at M3, so model logic never moves without a test. The rule is
SCOPE §1.3: a plugin whose model logic moves to Rust gets its tests recorded as A-rec in
M0/M1 (before the code moves); a plugin that stays JS runs on the shim (§2.3a) only.

| Group (files) | Tier | Moves in |
| --- | --- | --- |
| `plugins/tables/*` (10: `tableClear`, `tableDelete`, `tableCellContent`, `tableSelectAll`, `tableTabInsertRow`, `tableListTab`, `listToTable`, `listToTableUndo`, `tableCellResize` model half, `tableTouchSelection` model half) | A-rec | M1 (table model) / M3 (handlers) |
| `plugins/checkbox-to-task/*`, `plugins/checklist-controls/*`, `plugins/normalize-enter/*`, `plugins/list-swipe-indent/*` (model half), `builder/enterKeyUtils` | A-rec | M3 |
| `plugins/links/*`, `plugins/mentions/*`, `tests/mentionTrigger`, `tests/mentionCallbacks`, `plugins/markdown-shortcuts/*`, `editing/registerMarkdownEditing` | A-rec | M3 |
| `plugins/code/deleteCodeNode`, `plugins/shared/removeNodeAndRestoreSelection`, `plugins/node-transform/*`, `plugins/block-decorator-navigation/*`, `plugins/word-navigation/*` (model half), `plugins/normalize-triple-click/*`, `plugins/native-ios-backspace/*`, `plugins/keyboard-shortcuts/*` | A-rec (model) + shim | M3 |
| `plugins/find-and-replace/*`, `plugins/text-paste/*`, `plugins/media/*`, `plugins/comments/commentPlugin`, `collaboration/reconcile`, `utils.test`, `utils/*`, `tailContext` | A-rec where the trace is model-only, else shim | M3 |
| `component/**` (MagicChip presentation, MentionsMenu), `directive/*`, `plugins/gif/*`, `plugins/file-paste/*`, `plugins/actions/*`, `plugins/agent-commands/*`, `plugins/progress/*`, `plugins/restore-focus/*` | shim only (view or app logic) | stays JS |

The recorder's classification of each case is authoritative; the table above decides only
*when* each group must be recorded. The counts come from `fixtures/index.json`.

---

## 2. Tier B: upstream suites unmodified on the wasm core

### 2.1 Shape

```
packages/lexical-wasm-shim/
  src/index.ts           # the full `lexical` export surface (382 names in upstream src/index.ts, S2 §2)
  src/nodes/*.ts         # LexicalNode, ElementNode, TextNode, DecoratorNode, ParagraphNode,
                         #   RootNode, LineBreakNode, TabNode: JS classes over Rust records
  src/foreign.ts         # ForeignNode hosting (§2.4)
  (view code)            # imported from `packages/lexical-wasm-view` (@macro-inc/lexical-wasm-view,
                         #   S12 §1): upstream's reconciler/events/mutations/DOM selection, not copied here
  src/compat/            # one module per deep-imported core file (§2.3)
  src/backend/           # ShimBackend: `conformance` only, over `ConformancePort` (S12 §0.1, §2) (§2.8)
  pkg/                   # wasm-bindgen output of lexical_conformance_wasm (target nodejs + web, §2.8)
packages/lexical-conformance/tierb/
  vitest.core.mts        # config 1
  vitest.ported.mts      # config 2
  setup.ts               # wasm init + key counter
  ledger.json            # skip/xfail ledger (§2.6)
  reporter.ts            # ledger reconciliation + per-package results
```

The upstream test files are executed from `target/lexical-upstream/` (the pinned
tarball) with no source edits.

### 2.2 The two configs

Both configs extend upstream's `vitest.config.mts` with `mergeConfig`. They keep the
following from it:
- the `unit` project;
- `environment: 'jsdom'`;
- `@vitejs/plugin-react`;
- `dedupe: ['react','react-dom']`;
- `IS_REACT_ACT_ENVIRONMENT`;
- `LEXICAL_VERSION`;
- the `tsconfig.test.json` aliases (155 entries, built by `tsconfigTestAliases()`).

Our aliases are prepended, so they win:

```ts
// vitest.core.mts
const SHIM = path.resolve(__dirname, '../../lexical-wasm-shim/src');
export default mergeConfig(upstream, {
  plugins: [lexicalShimResolver({ shim: SHIM, upstreamRoot: UPSTREAM })],
  resolve: {
    alias: [
      { find: /^lexical$/, replacement: `${SHIM}/index.ts` },
      { find: /^@lexical\/internal\/(invariant|devInvariant|formatDevErrorMessage|formatProdErrorMessage)$/,
        replacement: `${SHIM}/compat/internal/$1.ts` },
    ],
  },
  test: {
    root: UPSTREAM,
    include: ['packages/**/__tests__/unit/**/*.test{.ts,.tsx}'],
    setupFiles: [`${UPSTREAM}/vitest.setup.mts`, path.resolve(__dirname, 'setup.ts')],
    reporters: ['default', path.resolve(__dirname, 'reporter.ts')],
    sequence: { concurrent: false },
  },
});
```

- **`vitest.core.mts` (core-only).** Only `lexical` is swapped. Every `@lexical/*`
  package resolves, as upstream does, to its upstream JS source. That source now runs as
  a JS client of the Rust core through the shim. This is the "every package is a core
  test" configuration.
- **`vitest.ported.mts` (ported).** This is the core-only config plus aliases for every
  package we port, pointing to Rust-backed shim modules:
  - `@lexical/list` → `shim/src/ported/list.ts`, and likewise for `link`, `table`,
    `code-core`, `mark`, `rich-text` (nodes and model commands), `markdown`, `history`,
    `selection`, `utils` and `hashtag`;
  - (R2, G-7) `clipboard`, `plain-text`, `overflow`, `text`, `offset`, `headless`, and
    `html` (its export names; its import names re-export upstream JS by design), so the
    counters below show what really runs in Rust for every crate S3 ports;
  - `@lexical/code` and `@lexical/code-prism` map to `ported/code.ts`, which keeps
    Prism tokenization in JS as a view concern (D6).

  Each ported module exports exactly the upstream module's names. A name that isn't
  ported yet re-exports upstream JS, and is listed in `ported/coverage.json`, so the
  ported config runs at every stage while its coverage grows. **Green with JS fallbacks
  is not a pass (C2):**
  - every shim export that can fall back to JS increments one of two counters,
    `rust_executed[name]` or `js_fallback[name]`, in DEV and test builds;
  - the reporter prints, per package, the share of calls served by Rust, and lists every
    name with `js_fallback > 0`;
  - **M3 gate (R2, G-4).** The gate covers exactly the P0 names whose S2 class is MODEL
    or BRIDGE **and** whose matrix `owner` is `rust:*` (S1/S3 map a Rust item; §0.2):
    for those, `ported/coverage.json` does not list the name and `js_fallback[name] == 0`
    across the whole ported run. Every other P0 name of an aliased package (VIEW, or "not
    ported"/n/a in S1/S3) has a `js-by-design` entry in `tierb/ledger.json`, generated from
    the matrix rows whose gate is `ledger:js-by-design`, each citing the S2 class or the
    S1/S3 line (32 names at R2, among them the audit's 16: `PrismTokenizer`,
    `getCodeLanguages`, `INSERT_CHECK_LIST_COMMAND`, `DRAG_DROP_PASTE`,
    `registerTableSelectionObserver`, `createDOMRange`, `createRectsFromDOMRange`,
    `setScrollableTablesActive`, `getDOMCellFromTarget`, `getTableElement`,
    `getTableObserverFromTableElement`, `calculateZoomLevel`, `isHTMLElement`, `IS_APPLE`,
    `IS_IOS`, `registerCodeHighlighting`; `TableDOMCell` is a type and is checked by the
    type test instead). The reporter fails when the ledger's `js-by-design` set differs from
    the matrix's, so a name that S1/S3 later port leaves the ledger in the same PR. Each such
    name still has its shim or Tier B test (§1.8f). P1 names may fall back only with a
    `not-ported` ledger entry naming the milestone that ports them.
  - **Matrix credit (G-1d).** A Tier B case counts toward a Rust-owned matrix row only
    when it ran with `rust_executed > 0` for that row's names (§0.1).

### 2.3 Deep imports and `resetRandomKey`

`lexicalShimResolver` is a `resolveId` hook (`enforce: 'pre'`):

1. It resolves the import normally, through `this.resolve(source, importer, {skipSelf: true})`.
2. If the resolved id is under `${UPSTREAM}/packages/lexical/src/` and **not** under
   `__tests__/`, it returns `${SHIM}/compat/<same relative path>`. A missing compat
   module is a hard error naming the file, never a silent fall-through to upstream
   internals.
3. Test utils (`packages/lexical/src/__tests__/utils/index.tsx`, the selection, react and
   headless `__tests__/utils`) stay upstream. Their own imports of core internals go
   through rule 2.

That covers every deep import in the 140 files. The compat modules and the exact names
tests import from them (collected from the test sources):

| Upstream module | Names tests import | Compat implementation |
| --- | --- | --- |
| `LexicalUtils` | `resetRandomKey`, `generateRandomKey`, `$getCompositionKey`, `$setCompositionKey`, `getEditorStateTextContent`, `getCachedTypeToNodeMap`, `getTextDirection`, `isArray`, `isExactShortcutMatch`, `isMoveToEnd`, `isMoveToStart`, `scheduleMicroTask`, `scrollIntoViewIfNeeded`, `emptyFunction` | key fns go to wasm (below); the view and keyboard helpers are upstream's own code, in `lexical-wasm-view`'s `view/` (S12 §1) |
| `LexicalSelection` | `$internalCreateRangeSelection`, `moveSelectionPointToSibling` | wasm |
| `LexicalNormalization` | `$normalizeSelection` | wasm |
| `LexicalNodeState` | `nodeStatesAreEquivalent` | wasm |
| `LexicalNode` | `LexicalNode` | shim class |
| `LexicalEditorState` | `EditorState` | shim class |
| `LexicalReconciler` | `$getReconciledDirection`, `__benchOnly` | `lexical-wasm-view` `view/` (reconciler stays JS) |
| `LexicalDOMSlot` | `ElementDOMSlot`, `indexPath` | `lexical-wasm-view` `view/` |
| `LexicalGenMap` | `cloneMap`, `GenMap` | upstream file copied verbatim; its 12 tests are N/A for the core but still pass as JS |
| `LexicalConstants` | `IS_BOLD` … `IS_UPPERCASE` (11 flags) | constants re-exported from wasm, asserted equal at init |
| `caret/LexicalCaret` | `$comparePointCaretNext` | wasm |
| `nodes/LexicalParagraphNode`, `nodes/LexicalRootNode`, `nodes/LexicalTextNode`, `nodes/LexicalElementNode`, `index` | `$createParagraphNode`, `$createRootNode`, `RootNode`, `$createTextNode`, types | shim classes |

**The `resetRandomKey` patch.** `packages/lexical/src/__tests__/utils/index.tsx:57`
imports `resetRandomKey` from `../../LexicalUtils` and calls it in `beforeEach`
(line 107). Keys must be deterministic and resettable, and they must match upstream's
**process-global** counter: `keyCounter` starts at 1 and is shared by every editor,
`LexicalUtils.ts:117–125`. Tests assert literal keys across nested and collab editors.

- The source patch is **not** needed, because rule 2 sends that import to
  `compat/LexicalUtils.ts`.
- Its `resetRandomKey()` calls `wasm.reset_key_counter()`, which calls
  `SharedKeyCounter::reset` on the instance's counter (S1 §2.1; with `KeySource::Shared`,
  `Editor::reset_key_counter` is not the reset).
- The wasm build, under `cfg(feature = "js-nodes")`, gives every shim-created editor
  `KeySource::Shared`. That is one `SharedKeyCounter` per wasm instance, and
  `NodeKey::to_string()` renders it as `"1"`, `"2"`, …
- Native builds keep per-editor keys.
- **Requirement on S1 (C7):** `EditorBuilder::key_source(KeySource)` with
  `pub enum KeySource { PerEditor, Shared(SharedKeyCounter) }`. `PerEditor` is S1 D-5's
  default. `Shared` is what Tier A strict mode (§1.6 item 6) and Tier B need to reproduce
  upstream's process-global counter across nested and collab editors. S1 R1 owns the type;
  S4 only requires it.

If a future upstream bump moves the import out of reach of the resolver, the fallback
is a one-line `patch-package` patch to `__tests__/utils/index.tsx`, recorded in
`ledger.json` under `patches`. That is the only upstream test-source edit allowed.

**`setup.ts`:**
- synchronously instantiates the wasm (`initSync(readFileSync(pkg/…_bg.wasm))`), so test
  files can import the shim at module top;
- asserts the wasm was built against the pinned upstream (`wasm.upstream_version() === '0.45.0'`);
- registers `afterEach(() => wasm.debug_live_editors() === 0 || fail)`. Editors are
  disposed through `Symbol.dispose` (291 `using editor` sites) or `setRootElement(null)`,
  and a leaked editor points at a handle-cache bug.

### 2.3a Running lexical-core and web tests on the shim

`packages/lexical-core` gets `vitest.shim.mts`, its normal vitest project plus the same
`lexical` alias and resolver. M3's exit criterion "lexical-core tests green on the
shim" is this config at 100%, with no ledger entries allowed. The web editor's plugin
tests (`apps/web/.../LexicalMarkdown/**/*.test.ts`) get a matching project in M3.

### 2.4 Hosting JS-defined node classes

There are 7 `DEFAULT_NODES` test classes and 48 more classes in 20 test files. The bases
are TextNode 16, ElementNode 13, DecoratorNode 7, ParagraphNode 4, ListNode 3,
ListItemNode 1 and LexicalNode 1. Every upstream package run as JS in the core-only
config also defines its nodes as JS subclasses. The shim must host all of them.

Each requirement below has its own acceptance test in
`packages/lexical-wasm-shim/src/__tests__/hosting.test.ts`. Those tests are ours, run in
both configs, and are written as one literal test per requirement.

1. **ForeignNode registry entry.**
   - At `createEditor`, each `nodes[]` class becomes a Rust `NodeDef`:
     `{type, kind: Element|Text|Decorator|LineBreak|Root, ancestry, behavior}`.
     - `kind` and `ancestry` come from walking `Object.getPrototypeOf(Klass)` to the
       nearest shim base. `ancestry` lists every registered type it extends, so
       `$isParagraphNode` holds for `class X extends ParagraphNode`.
   - Native Rust types have native behaviour. JS-only types get
     `ForeignBehavior { overrides: u64 /* bitmask */, dispatch: js_sys::Function }`.
   - Replacements (`{replace, with, withKlass}`) and `$config()` records are resolved the
     way `getStaticNodeConfig` does (`LexicalUtils.ts:2348`), including its
     monkey-patching of `getType`/`clone`/`importJSON`.
   - *Acceptance:* `class P2 extends ParagraphNode`, registered with a replacement, makes
     `$createParagraphNode()` return a `P2`, makes `$isParagraphNode` true, and gives JSON
     `type: "p2"`.
2. **Override bitmask by prototype walk.**
   - For each model hook `h`, bit `h` is set iff `Klass.prototype[h] !== Base.prototype[h]`,
     where Base is the nearest *native* ancestor. A JS subclass of a JS subclass inherits
     its parent's bits.
   - **The hook set is derived, not hand-listed (C3).** `shim/scripts/derive-hooks.ts`
     (run in CI, output committed as `src/hooks.generated.ts`) takes every method on
     upstream's `LexicalNode`, `ElementNode`, `TextNode` and `DecoratorNode` prototypes,
     removes the view-only ones (`createDOM`, `updateDOM`, `exportDOM`, `importDOM`,
     `decorate`, `getDOMSlot`, `isSelected` via DOM, …; the exclusion list is the S2 VIEW
     column), and keeps those that core or package code calls polymorphically (a call
     `node.<h>(` or `this.<h>(` anywhere in `packages/*/src` outside `__tests__`). The
     check fails unless the derived set equals the Rust `ForeignBehavior` hook enum plus
     S1 R1's explicit **non-hook** list (S1 §3.2, D-C3).
   - Hooks (bit-dispatched to JS), each with its S1 §3.2 counterpart: `isInline`,
     `canBeEmpty`, `canIndent`, `isShadowRoot`, `canInsertTextBefore`,
     `canInsertTextAfter`, `canMergeWith`, **`canMergeWhenEmpty`** (QuoteNode
     `rich-text/index.ts:208`, ListItemNode `:552`), `canReplaceWith`, **`canInsertAfter`**,
     `excludeFromCopy`, `extractWithChild`, `getIndent` (`indent`), `splice`, `append`,
     `setIndent`, `insertNewAfter`, `collapseAtStart` (`ElementNode`); `remove`, `replace`,
     **`insertAfter`**, **`insertBefore`**, **`resetOnCopyNodeFrom`** (`reset_on_copy`;
     ListItemNode `:516`, `:341`, `:387`), `isParentRequired`, `createParentElementNode`
     (`create_parent_element`), `importJSON` (`import`), `updateFromJSON`, `exportJSON`
     (`adjust_export_json`), `afterCloneFrom`/constructor (`after_clone`), static
     `transform`/`$config().$transform` (`static_transform`) (`NodeType`);
     **`isTextEntity`** (HashtagNode `:38`), **`canHaveFormat`** (CodeHighlightNode `:78`),
     `selectionTransform`, and the setter overrides `setTextContent`/`spliceText`/
     `setDetail`/`setMode`/`setFormat` through the `coerce_*`/`check_splice_text` hooks
     (`TextNode`); `isIsolated`, `isKeyboardSelectable`, `getTextContent` (`DecoratorNode`).
   - **Non-hooks** (S1 §3.2: no upstream package or Macro node overrides them): `isSimpleText`,
     `splitText`, `mergeWithSibling`, `select`, `selectStart`, `selectEnd`, `selectNext`,
     `selectPrevious`, `getTopLevelElement`, plus `getTextContent`/`getTextContentSize` on
     element and text nodes and `isSegmented`/`isToken`/`isUnmergeable` (read from
     `TextData`). A JS subclass that overrides one gets the base behaviour; Rust never calls
     it. `canBeTransformed` (listed in R0) does not exist in v0.45 and is removed.
   - Rust calls into JS **only** for set bits, so built-ins stay native.
   - **Prototype changes after `createEditor` (C4).** Upstream itself patches `getType`,
     `clone` and `importJSON` in `getStaticNodeConfig` (`LexicalUtils.ts:2348`), and tests
     `vi.spyOn(Klass.prototype, …)` after `createEditor`. The shim installs a write trap
     (`Object.defineProperty` setter on each registered prototype's hook slots) that
     recomputes that class's bitmask on write. It throws only when a hook's bit flips
     from native to JS **after the editor's first update** (Rust may already have taken
     the native path), with a message naming the hook; a `vi.spyOn` before the first
     update is honoured and lands no ledger entry.
   - *Acceptance:* `hosting.test.ts` has **one literal test per derived hook**: a JS
     subclass that overrides the hook with a call counter, registered in an editor, and
     a scenario where upstream calls that hook (for example `canMergeWhenEmpty`: Backspace
     at the start of an empty quote after a quote). The counter must be > 0 in both
     configs. Plus: a subclass that doesn't override `isInline` makes zero JS calls for
     it, counted through a debug counter; and **one literal test per non-hook**: a JS
     subclass that overrides it with a call counter gets the base behaviour and a counter of
     0 (S1 §3.2). An upstream test that depends on such an override is a ledger entry.
3. **Own enumerable `__field` accessors.**
   - Each JS node instance gets own, enumerable accessor properties for the core
     fields: `__type`, `__key`, `__parent`, `__prev`, `__next`, `__state`, plus by kind
     `__first`, `__last`, `__size`, `__format`, `__style`, `__indent`, `__dir`,
     `__textFormat`, `__textStyle`, `__text`, `__mode`, `__detail`.
   - They are defined once in the constructor. Getters read the Rust record of
     *this version*. Setters exist only so that `getWritable()` clones and the
     constructors of JS subclasses can initialise; writing a field on a frozen version
     throws the same error upstream throws in DEV.
   - Custom fields (`__url`, `__block`, `__caption`, …) are ordinary JS own properties
     on the instance held in the record's `ext` slot.
   - The reason: `@lexical/yjs` discovers synced props with
     `Object.entries(new nodeInfo.klass())`, and 40 test files read these fields.
   - *Acceptance:* `Object.keys(new TestElementNode())` equals upstream's list, in
     upstream's order. That list is recorded once from upstream into the test as a
     literal.
4. **Handle identity cache.**
   - JS node objects are per-(EditorState version, key) handles, cached in a `Map`
     owned by the state.
   - `$getNodeByKey(k)`, `getParent()`, `getChildren()[i]`, `selection.getNodes()[i]` and
     `$getRoot()` return the identical object within one read or update.
   - `getWritable()` returns the writable version's handle, also cached, so
     `node.getWritable() === node.getWritable()`. `getLatest()` maps a stale handle to
     the current one.
   - The cache dies with the state: no global `Map`, and nothing leaks across tests.
   - *Acceptance:* `toBe` checks hold, and `$getNodeByKey(k) === $getNodeByKey(k)` inside
     an update. After commit, the previous state's handles still read the previous values.
5. **Reentrancy.**
   - Transforms, `insertNewAfter`, `collapseAtStart`, command handlers, `importJSON`,
     `updateFromJSON`, NodeState `parse` and listeners are JS called from Rust mid-update.
     They call `$`-functions back into wasm.
   - The update loop therefore holds no `RefCell` borrow and no `&mut` across a callout.
     The active `Transaction` lives in a thread-local slot (`ACTIVE: RefCell<Option<*mut Tx>>`,
     borrowed per call, never across one), which is notes-core §3.1's FFI facade. Between wasm
     calls the open update is an S1 §4.4 `PendingUpdate` (`Transaction::suspend` /
     `Editor::resume`, feature `foreign-nodes`), held by `EditorHandle` (§2.8).
   - JS `registerCommand` and `registerNodeTransform` calls after `createEditor` go through
     S1 §4.4 `Editor::register_foreign_listener` / `register_foreign_transform` (and their
     `unregister_*`); the listener table refreshes on each.
   - Nested `editor.update` inside an update queues onto the same pending state (shim
     only, SCOPE divergence 2).
   - An update on a *different* editor from inside an update pushes a new TLS frame and
     restores it in `finally`, as `LexicalUpdates.ts:991–999` saves and restores
     `activeEditor`.
   - *Acceptance:* a TextNode transform that calls `node.insertAfter($createTextNode())`
     and `editor2.update(...)`. The transform fixpoint guard fires after 100 iterations
     with upstream's exact message.
6. **Microtask commit ordering.**
   - Commit scheduling stays in JS and copies upstream:
     - `queueMicrotask` unless `discrete`, or unless the composition key changed;
     - one commit per tick for all updates in that tick;
     - `onUpdate` deferreds run after update listeners;
     - `$triggerEnqueuedUpdates` runs after listeners.
   - The Rust `Transaction` stays open across the tick via the batching boundary from §1.6.
   - The 623 `await editor.update(...)` sites rely on this.
   - *Acceptance:* the commit ordering tests in `LexicalEditor.test.tsx` pass in both
     configs, plus an explicit literal test: two updates in one tick → one update
     listener call with both changes.
7. **NodeState values.** Values are `JsValue` slots keyed by StateConfig identity, with
   `parse`/`unparse`/`isEqual` called back. On the Rust side each JS `createState` config is an
   S1 §4.4 `ForeignStateConfig` (its `ForeignStateCodec` calls `isEqual`), values are written
   with `Transaction::set_foreign_state` and read with `Read::foreign_state`. Unparsed JSON stays as `unknownState` until
   first read, as in upstream.
8. **Strings and errors.** Offsets cross the boundary as UTF-16 code units. Invariant
   messages come from Rust with upstream's text. `compat/internal/invariant.ts` re-throws
   them as `Error` with the same message, so `toThrow('msg')` (17 sites) matches.
9. **Private-field compat getters.** These are read-only views over the Rust state:
   - `editor._nodes`, `_config`, `_editorState`, `_pendingEditorState`, `_headless`,
     `_window`, `_updateTags`, `_dirtyLeaves`, `_dirtyElements`, `_commands`,
     `_listeners`, `_deferred`, `_keyToDOMMap` (view-owned);
   - `editorState._nodeMap` (a `Map`-like over Rust), `_selection`.

   A write to any of them fails with `TypeError` and lands the test on the ledger as
   `private-write`.

10. **Boundary crossings are counted precisely (C6).** A *crossing* is one call of a
    wasm export, counted by a shim counter `wasm.debug_crossings()` (export calls) and
    `wasm.debug_boundary_bytes()` (bytes copied either way, strings counted in UTF-16
    units × 2). Field getters of item 3 that read the Rust record are crossings. To keep
    the reconciler's reads off the boundary, each committed `Diff` carries the changed
    records' fields, and the shim caches them in the per-version handle (item 4), so a
    getter on a node the commit touched reads JS memory. The perf gate (§5.4) is on
    total crossings and bytes per keystroke, not on "calls into the model".

### 2.5 View layer

Without the view, `initializeUnitTest` fails in `beforeEach`, and stage A runs about
30% of the pool (§2.7 table). Stage B ports upstream's JS view onto the shim:
- `LexicalReconciler.ts`, `LexicalEvents.ts`, `LexicalMutations.ts`, `LexicalDOMSlot.ts`,
  the DOM halves of `LexicalSelection.ts`/`LexicalUtils.ts`/`LexicalUpdates.ts`, and
  `createDOM`/`updateDOM`/`exportDOM` of the base nodes;
- they live, with their file names, in `packages/lexical-wasm-view`'s `view/` (S12 V-1, §1),
  so upstream diffs apply mechanically on bump, and the shim imports them (not a copy), so
  Tier B exercises the production view;
- they are retargeted to read the view's mirror of the Rust model (S12 V-2).

The reconciler no longer writes the model (SCOPE divergence 3):
- `__cachedText`, element `__textFormat`/`__textStyle` and `__dir` writes are deleted;
- Rust computes them at commit;
- the view reads them.

The fast-path tests in `LexicalReconciler.test.ts` stay on, as checks that the
Rust-computed caches equal what the JS reconciler used to compute.

**What jsdom cannot see (C5).** jsdom has no layout, no `Selection.modify`, no
`getTargetRanges`, no real IME and no paint, so some bug classes reach no jsdom tier. From
the start of M3 they are covered per PR in a real browser:
- the upstream playground e2e subset for typing, selection, IME and paste
  (`packages/lexical-playground/__tests__/e2e/{Selection,TextEntry,Composition,Keyboard,Navigation,History,List,Tables,Markdown}.spec.mjs` and `CopyAndPaste/`)
  on the shim build, Chromium, ledgered like Tier B (`tierb/ledger.e2e.json`);
- S4 e2e E24 (word and line deletes via real key chords, the divergence-4 path with
  host-supplied target ranges).

The full playground e2e suite stays weekly.

### 2.6 Ledger

`packages/lexical-conformance/tierb/ledger.json` (Tier A's `ledger.json` uses the same
format):

```json
{
  "upstream": "0.45.0",
  "patches": [],
  "entries": [
    {
      "config": ["core", "ported"],
      "file": "packages/lexical/src/__tests__/unit/LexicalGenMap.test.ts",
      "test": "*",
      "status": "na",
      "reason": "genmap",
      "note": "GenMap is replaced by the persistent map; the file still runs as JS for information"
    },
    {
      "config": ["core", "ported"],
      "file": "packages/lexical/src/__tests__/unit/LexicalEditor.test.tsx",
      "test": "LexicalEditor tests > mutation listeners > headless",
      "status": "xfail",
      "reason": "divergence-mutation-timing",
      "link": "SCOPE.md §2b divergence 1"
    }
  ]
}
```

- `status`:
  - `na`: excluded with `test.skip` semantics and not run;
  - `xfail`: runs, and must fail;
  - `flaky`: runs, and its result is ignored. This needs a `link` to an issue and expires
    after 30 days.
- `reason` is a closed enum, so the ledger can be summarised:
  - `genmap`, `lint`;
  - `reconciler-internal` (`__cachedText`/`_keyToDOMMap`/DOMSlot fast-path internals);
  - `private-write`;
  - `vi-mock-internal` (11 files mock or spy on core internals);
  - `ime-timing`;
  - `macro-patch` (list indent, `$clearText`);
  - `divergence-<n>` (SCOPE §2b list);
  - `d6-highlight` (asserts `CodeHighlightNode` children);
  - `html-import-js` (only in configs where HTML import moved);
  - `not-ported` (ported config only, while a name re-exports upstream; not allowed for
    Rust-owned P0 names at M3, §2.2);
  - `js-by-design` (a P0 name of an aliased package that S2 classes VIEW or S1/S3 do not
    port; generated from the matrix, §2.2);
  - `foreign-class` (only if D2 picks the cheaper option, §2.7);
  - `dev-only-invariant` (§1.3 item 4), `tape-order` (§1.4), `cascade` (§1.7
    `cascadeCommits`, Tier A only), `lone-surrogate` (S1 D-6, audit-r1-B R-5).
- Every entry has `reviewedBy` and `decision` (a link to the S1/S3 divergence or the PR
  discussion). The reporter fails on an entry missing either.
- `test` is the full vitest name joined with ` > `, or `*` for the whole file. Globs are
  not allowed below file level, so every skipped case is visible.
- `reporter.ts` reconciles the run against the ledger and fails CI on:
  - an unexpected failure;
  - an `xfail` that passes (a stale entry: delete it);
  - an entry whose file or test no longer exists.

  It writes `tierb/results/<config>.json`, with per-package counts by
  status and reason, and a markdown summary for the job page.
- Every Lexical bump re-runs both configs and posts the ledger diff in the bump PR.

### 2.7 Expected pass rate

Estimates are per package, from §1.9:
- **Stage A** is the headless shim with no view layer. Every `initializeUnitTest` file
  fails in `beforeEach`.
- **Stage B** adds the view layer and compat. It assumes A ≈ 97%, B-only ≈ 90% and
  view ≈ 70%.
- **Ported** counts the packages we port at slightly lower rates until their Rust ports
  settle.

**The gate is not a percentage (C1).** 20% of 2,166 runnable cases is about the size of
the whole B-only pool (423), so an 80% bar could pass with every behaviour that only Tier
B checks failing. The M3 gate is:
- **100% of non-ledgered cases pass, in both configs.** Every ledger entry has a
  closed-enum reason (§2.6), is reviewed in the PR that adds it, and links the decision.
- **Per-category floors**, computed over all runnable cases including ledgered ones:
  - B-only cases (the §1.9 B-only column, as re-derived by the recorder): **≥ 95%** pass;
  - the P0 packages (`lexical`, `@lexical/table`, `list`, `markdown`, `link`, `mark`,
    `rich-text`, `history`, `utils`, `selection`, `clipboard`): **100% minus
    `divergence-<n>`, `d6-highlight` and `dev-only-invariant` entries**;
  - `lexical-core` on the shim: 100%, no ledger (§2.3a);
  - `vi-mock-internal` and `private-write` entries: ≤ 30 cases in total, each listed.
- The overall percentage is printed on the dashboard and in the release PR. It gates
  nothing. SCOPE M3's "Tier B ≥ 80%" is superseded by this rule.

The table below is the plan estimate; the rest of it is margin.


| Package | Cases | N/A (ledger) | Headless shim (stage A) | Core-only, stage B | Ported, stage B |
| --- | ---: | ---: | ---: | ---: | ---: |
| `lexical (core)` | 636 | 14 | 37 (6%) | 548 (86%) | = core-only |
| `lexical-markdown` | 393 | · | 334 (85%) | 381 (97%) | 373 (95%) |
| `lexical-table` | 95 | · | 14 (15%) | 76 (80%) | 76 (80%) |
| `lexical-list` | 97 | · | 34 (35%) | 84 (87%) | 82 (85%) |
| `lexical-link` | 102 | · | 51 (50%) | 93 (91%) | 91 (89%) |
| `lexical-code` | 22 | · | 2 (9%) | 17 (77%) | = core-only |
| `lexical-code-core` | 16 | · | 10 (62%) | 14 (88%) | 14 (88%) |
| `lexical-code-prism` | 86 | · | 0 (0%) | 83 (97%) | 81 (94%) |
| `lexical-code-shiki` | 86 | · | 0 (0%) | 77 (90%) | = core-only |
| `lexical-mark` | 7 | · | 0 (0%) | 7 (100%) | 7 (100%) |
| `lexical-rich-text` | 65 | · | 29 (45%) | 57 (88%) | 56 (86%) |
| `lexical-selection` | 238 | · | 5 (2%) | 190 (80%) | 188 (79%) |
| `lexical-utils` | 36 | 1 | 10 (28%) | 32 (89%) | 31 (86%) |
| `lexical-history` | 18 | · | 0 (0%) | 17 (94%) | 17 (94%) |
| `lexical-html` | 81 | · | 49 (60%) | 69 (85%) | = core-only |
| `lexical-clipboard` | 16 | · | 10 (62%) | 14 (88%) | = core-only |
| `lexical-headless` | 8 | · | 7 (88%) | 8 (100%) | = core-only |
| `lexical-extension` | 24 | 1 | 17 (71%) | 20 (83%) | = core-only |
| `lexical-hashtag` | 1 | · | 0 (0%) | 1 (100%) | 1 (100%) |
| `lexical-react` | 126 | · | 0 (0%) | 98 (78%) | = core-only |
| `lexical-playground` | 28 | · | 11 (39%) | 26 (93%) | = core-only |
| `lexical-tailwind` | 1 | · | 0 (0%) | 1 (100%) | = core-only |
| `lexical-eslint-plugin` | 11 | 11 | 0 (0%) | 0 (0%) | = core-only |
| **total** | **2193** | **27** | **620 (28%)** | **1913 (87%)** | **1895 (86%)** |


Notes:
- `lexical-code-shiki` is not ported, so its ported column equals core-only. Its tab
  scenarios still exercise the Rust core through the JS code package.
- `lexical-react` collab (28 cases) needs `@lexical/yjs` over the shim's enumerable
  fields (§2.4 item 3). It is the strongest check that the field accessors are right.
- Under D2's cheaper option (port only the 7 `DEFAULT_NODES` classes and skip the 20
  files that define their own node classes), the ledger gains those 20 files, about 420
  cases, under reason `foreign-class`. Stage B drops to about 68%, in line with SCOPE
  D2's 60–70%.

### 2.8 `lexical_conformance_wasm`: the conformance wasm surface (audit-r2-4 B2, H7)

S7 §0 folded SCOPE's `lexical_model_wasm` into the shipped `document_session_wasm`, whose
exports (`EditorSession`, `DocSession`, `SyncRouter`) are the production surface and make no
callbacks into JS. Tier B, Tier C's R side and the perf `core` cell need a different surface: a
raw core with no session, upstream-compatible compat functions, a process-global key counter,
and JS-defined node classes called from inside a transaction. That surface is a separate,
dev-only crate, so the shipped cdylib never contains it.

**Crate.** `crates/client/lexical/lexical_conformance_wasm`, `crate-type = ["cdylib", "rlib"]`,
`publish = false`. Dependencies: `lexical_model`, `lexical_rich_nodes`, `lexical_markdown`,
`lexical_html` (export), `macro_document_model` with `default-features = false` (the
`macro`/`macro-export` Tier C profiles), `lexical_conformance` (its `api` dispatch, below),
`wasm-bindgen`, `js-sys`, `serde-wasm-bindgen`, `postcard` (only for `EditorHandle::commit`'s
dev-only buffer), and S7's `session.bop` codec crate for
`Input`/`Output` (S1 §11.4: `lexical_model` has no wire derives, so there is no `wire`
feature). It is under `crates/client/*`, so hakari's `traversal-exclude-globs` already
excludes it (audit-r2-4 M3). It depends on `lexical_model` with feature `foreign-nodes`
(S1 §4.4), the only crate that enables it. Its own feature `js-nodes` (on in every build of
this crate) enables the ForeignNode host and `KeySource::Shared`.

**Never shipped; checked.** CI asserts (§7): no crate outside `lexical_conformance*` depends on
it (`cargo tree --workspace -i lexical_conformance_wasm -e normal` lists only itself); no
`apps/` or `packages/` file except `packages/lexical-wasm-shim/src/backend/conformance.ts`,
`packages/lexical-conformance/**` and the shim's test setup imports its `pkg/`; and the web
production bundle contains none of its exported symbol names. S7's "no callbacks from Rust into
JS" rule binds the shipped crates; this crate is its only exception, and only under
`js-nodes`.

**Builds.** `just build-lexical-conformance-wasm` runs `wasm-pack build --target nodejs`
(Tier B, Tier C in node) and `--target web` (perf `core` cell, playground e2e subset), both
`--release` with `wasm-opt -O3`, into `packages/lexical-wasm-shim/pkg/{node,web}/`
(gitignored), through `scripts/cached-wasm-build.sh lexical_conformance_wasm` keyed on
`.github/workspace-dep-closures.json` (so `cargo x deps` runs when the crate lands).

**Exports** (`src/lib.rs`; every handle is a `#[wasm_bindgen]` struct that frees on
`Symbol.dispose`/`free()`; errors are `JsError` whose message is the Rust `Error`'s
`to_string()`, i.e. upstream's invariant text, §2.4 item 8):

```rust
// --- build identity and debug counters ---------------------------------------------------
#[wasm_bindgen] pub fn upstream_version() -> String;            // "0.45.0", from upstream.lock
#[wasm_bindgen] pub fn reset_key_counter();                      // SharedKeyCounter::reset (§2.3)
#[wasm_bindgen] pub fn debug_live_editors() -> u32;              // editors not yet dropped
#[wasm_bindgen] pub fn debug_crossings() -> f64;                 // export calls since reset (§2.4 item 10)
#[wasm_bindgen] pub fn debug_boundary_bytes() -> f64;            // bytes copied either way
#[wasm_bindgen] pub fn debug_reset_counters();
/// The 11 `IS_*` text-format flags, as `{IS_BOLD: 1, …}`; `setup.ts` asserts them equal to
/// upstream's `LexicalConstants` at init (§2.3).
#[wasm_bindgen] pub fn text_format_flags() -> JsValue;

// --- Tier C "R" and the perf core cell: the sans-IO EditorCore ---------------------------
#[wasm_bindgen] pub struct CoreHandle { /* EditorCore */ }
#[wasm_bindgen] impl CoreHandle {
    /// `profile`: "upstream" | "macro" | "macro-export" (§3.1). The `CoreConfig` (S1 §15)
    /// fields arrive as primitives (`mode`, `opaque_unknown_types`, history delay, …), with
    /// `KeySource::PerEditor` (Tier C builds one per run). The view host is set with
    /// `EditorBuilder::view_host` (S1 §15; `CoreConfig` has no platform field).
    #[wasm_bindgen(constructor)] pub fn new(profile: &str, mode: u8, opaque_unknown_types: bool, history_delay_ms: f64, seed_state_json: Option<String>) -> Result<CoreHandle, JsError>;
    /// One `EditorCore::apply`: `input` is an `Input` encoded with S7's `session.bop` codec
    /// (`EditorInputMsg`, the same as production, S1 §11.4), the return value the encoded
    /// `Output`. The TS side uses the generated `session.bop` bindings (WP-14 round-trip test).
    pub fn apply(&mut self, input: &[u8], now_ms: f64) -> Result<Vec<u8>, JsError>;
    pub fn state_json(&self) -> Result<String, JsError>;          // to_js_json_string (key order kept)
    pub fn selection_json(&self) -> Result<String, JsError>;
    pub fn markdown(&self, transformers: &str) -> Result<String, JsError>;  // "upstream" | "internal" | "external" | "all"
}

// --- Tier B: the shim's $-API backend ---------------------------------------------------
#[wasm_bindgen] pub struct EditorHandle { /* Editor + Option<PendingUpdate> (S1 §4.4); the resumed Transaction sits in the TLS slot during a call (§2.4 item 5) */ }
#[wasm_bindgen] impl EditorHandle {
    /// `config`: `{namespace, nodes: NodeDef[], theme?, editable, onError?}` as JSON; each
    /// `NodeDef` is §2.4 item 1's record. Built with `KeySource::Shared`.
    #[wasm_bindgen(constructor)] pub fn new(config: JsValue) -> Result<EditorHandle, JsError>;
    /// The API index: every upstream API name the dispatch table maps, in id order.
    /// The shim resolves names to ids once at init.
    pub fn api_index() -> Vec<String>;
    /// One upstream API call, dispatched by `lexical_conformance::api` — the same table the
    /// Tier A replayer uses (§1.6), so the shim and the replayer can never map a name two
    /// ways. Arguments and the result use the fixture value encoding (§1.5: primitives,
    /// `{"$h": n}` handles, `{"$key": k}`), through serde-wasm-bindgen.
    /// Inside an update: `Editor::resume` the `PendingUpdate`, run, `Transaction::suspend`.
    pub fn call(&mut self, api_id: u32, args: JsValue) -> Result<JsValue, JsError>;
    /// Opens a transaction and suspends it into the `PendingUpdate` slot.
    pub fn begin_update(&mut self, tags: Vec<String>, discrete: bool) -> Result<(), JsError>;
    pub fn flush(&mut self) -> Result<(), JsError>;              // resume, Transaction::flush, suspend (§1.6 item 1)
    /// Resumes and commits; returns the commit's `Diff` with the changed records' fields (§2.4
    /// item 10) and the mutation list the shim's listener emulation reads, as one postcard
    /// buffer (a dev-only format of this crate, not an S1 type). A stale `PendingUpdate`
    /// (`Error::StaleSuspendedUpdate`) is a `JsError`.
    pub fn commit(&mut self) -> Result<Vec<u8>, JsError>;
    pub fn read_field(&self, handle: u32, field: &str) -> Result<JsValue, JsError>;  // §2.4 item 3 getters
    /// `js-nodes`: register a JS class as a ForeignNode (§2.4 items 1–2). `overrides` is the
    /// hook bitmask; `dispatch(hook_id, handle, args) -> result` is called only for set bits.
    pub fn register_foreign(&mut self, def: JsValue, overrides: u64, dispatch: js_sys::Function) -> Result<(), JsError>;
    /// `js-nodes`: `registerCommand`/`registerNodeTransform` after build (§2.4 item 5), through
    /// S1 §4.4 `register_foreign_listener`/`register_foreign_transform`; returns the id the
    /// unregister call takes.
    pub fn register_listener(&mut self, command: &str, priority: u8, dispatch: js_sys::Function) -> Result<u32, JsError>;
    pub fn register_transform(&mut self, type_name: &str, dispatch: js_sys::Function) -> Result<u32, JsError>;
    pub fn unregister(&mut self, id: u32);
}
```

The deep-import compat functions of §2.3 are API names in the index, not extra exports:
`lexical.$normalizeSelection`, `lexical.$internalCreateRangeSelection`,
`lexical.$comparePointCaretNext`, `lexical.nodeStatesAreEquivalent`,
`lexical.moveSelectionPointToSibling`, `lexical.$getCompositionKey`/`$setCompositionKey`.
`hosting.test.ts` asserts every name of the §2.3 compat table is in `api_index()`.

**The S1 hook it uses.** `register_foreign` builds an S1 §4.4 `ForeignNodeType` (feature
`foreign-nodes`, enabled only by this crate): `type_name`/`class_name` from the class,
`kind` and `extends` from §2.4 item 1's prototype walk, `required_state` from
`$config().stateConfigs`, and `hooks: Arc<JsHooks>`. `JsHooks` implements S1's `ForeignHooks`:
for a hook whose bit is clear in `overrides` it returns `Override::Inherit` without crossing the
boundary; for a set bit it calls `dispatch(hook_id, handle, args)` and returns
`Override::Value`. `JsHooks` wraps the `js_sys::Function` in a newtype with `unsafe impl Send +
Sync`, sound only on single-threaded `wasm32-unknown-unknown`; the crate asserts
`#[cfg(not(target_feature = "atomics"))]` (S1 §4.4). A foreign node's own JSON fields live in
S1's `ForeignData { fields }`; the shim's per-instance JS properties (§2.4 item 3) are views
over it. `hosting.test.ts` has one test per `ForeignHooks` method (the §2.4 item 2 call-counter
tests), and a `cargo x deps` check (S1 §4.4) denies `foreign-nodes` in every shipped crate.

**The shim has one backend (R2.1, S12 V-1).** The shim is dev-only. `packages/lexical-wasm-shim/src/backend/`
defines `ShimBackend` (the calls above, as a TS interface) with one implementation,
`conformance.ts` over this crate (Tier B, `DIFF_TARGET=shim`, the perf `core` cell, the
playground e2e subset), reached through S12's `ConformancePort`. Production has no `lexical`
facade: the web runs `@macro-inc/lexical-wasm-view`'s `EditorView` over `SessionPort` and
`document_session_wasm` (S12 §0.1, §1). The view code is shared, so `DIFF_TARGET=view` (§3.1)
and Tier B exercise the production view; the R2 `session.ts` backend and
`backend_parity.test.ts` are dropped.

---

## 3. Tier C: differential equivalence

### 3.1 Lockstep harness

`packages/lexical-conformance/diff/` runs in node with no DOM. Each fast-check run
builds two editors from the same seed state:

- **U**, upstream: `createHeadlessEditor` from the pinned v0.45.0 packages, production
  build. It has the same plugins as the profile, with Macro's markdown patch for the
  Macro profile.
- **R**, Rust: `lexical_conformance_wasm`'s `CoreHandle` (§2.8), the sans-IO `EditorCore`
  driven through `apply(Input, now)` (the `session.bop` encoding, §2.8), **not through the
  shim**. That way a shim bug can't mask or cause a divergence.
  - `DIFF_TARGET=view` (R2.1, S12 §5.1) runs **per PR** (2k steps, fixed seeds): R is
    `EditorCore` through `ConformancePort` with the production `EditorView` mounted on a
    jsdom root; after every step the view's mirror and DOM are checked against R's state.
  - `DIFF_TARGET=shim` drives R through the shim's `lexical` API instead. The shim is dev-only
    (S12 V-1), so this mode runs **nightly** only (D6).
- **U with a jsdom root for view-input commands (D1).** `TextFromView`,
  `SelectionFromView` and `Composition` need upstream's DOM-reading path. For those, U is a
  second upstream editor with a jsdom `contenteditable` root attached
  (`createEditor` + `setRootElement`), kept in lockstep with the headless U by
  `setEditorState` before the step. The step sets the DOM text node's `nodeValue` and the
  DOM selection, then dispatches `input` (or, for selection only, `selectionchange`), so
  U runs `$updateSelectedTextFromDOM` → `$updateTextNodeFromDOMContent` exactly as a real
  keystroke does. The resulting state is copied back to the headless U.

**Seed states (D6).** Each run starts from one of:
- empty (one paragraph), 20%;
- a document from the synthetic per-node generator (§3.6b), 40%: every node type of the
  profile, with every serialized field present, absent or null where JS allows it;
- grammar-generated markdown imported on both sides (the `PasteMarkdown` grammar), 30%;
- a fixture's `final.json` (any A-rec fixture of the profile's packages), 10%.

**Long runs (D4).** Upstream's `_cascadeCount` reset bug (SCOPE bug 2: error #343 after
about 90 listener-enqueued cascades) is patched **in the U oracle only**: one line in the
pinned copy, `diff/patches/cascade-count.patch`, ledgered as `divergence-cascade-guard`
with a link to the upstream issue. With the patch, run length is no longer capped: per-PR
runs are 1–200 steps, nightly runs 1–5,000 steps, so deep undo stacks, merge windows over
many steps, large documents and history `maxDepth` eviction are reached. A
`console.error` capture on U still fails the run on any other error.

Two node profiles:

| Profile | Nodes and plugins | Why |
| --- | --- | --- |
| `upstream` | `DEFAULT_NODES` minus test classes; rich-text, list, link + autolink, table, code (no highlighter, D6), mark, hashtag, history | the core and our ports |
| `macro` | `SupportedNodeTypes` (57) + `NodeReplacements`, nodeIdPlugin with a seeded id generator on both sides, `INTERNAL_TRANSFORMERS`, list indent 2, `$clearText` patch | what the web editor and the composers/snapshots store (`headless_editor()`) |
| `macro-export` | `SupportedNodeTypes` (57), **no** `NodeReplacements`: lexical-service's exact editor (`services/lexical-service/src/lib/editor.ts`) | what the gate and the doc-id export routes run (S3 CR-17 export registry); the gate verdict and the export bytes are compared in this profile |

Determinism:
- `resetRandomKey()` is called on U before each run, and R's `Editor` is built fresh per run
  (`KeySource::PerEditor` starts at 1; `EditorCore` exposes no `&mut Editor`, S1 §15);
- both use the same seeded id generator and the same injected history clock (`now`
  is passed to `registerHistory`, `lexical-history/src/index.ts:706`);
- no wall-clock reads.

### 3.2 Command set

A command is plain data (`diff/commands.ts`), turned into an upstream `editor.update`
on U and an `Input` on R. Targets are chosen from **U's current state** as indexes into
a DFS list of candidates, for example "the 3rd text node" or "the 2nd table cell". The
same index resolves identically on R when the trees are equal, and they are compared
before every step.

| Command | Generator | Notes |
| --- | --- | --- |
| `Select {anchor, focus}` | random points: text points at any UTF-16 offset **including inside surrogate pairs** (must normalize identically), element points, backward and collapsed, NodeSelection over decorators, TableSelection over cell ranges | precedes most edits |
| `InsertText(s)` | `fc.string` over a weighted alphabet: ASCII, space, `\t`, `\n`, astral (😀 U+1F600, 𝔸), combining marks (e + U+0301), ZWJ sequences (👩‍👩‍👧), RTL (Hebrew, Arabic), U+FEFF, U+00A0, U+2028 | `\n` becomes a paragraph break in rich text, as upstream does |
| `DeleteCharacter {backward}`, `DeleteWord`, `DeleteLine`, `RemoveText` | | word and line need layout upstream (`Selection.modify`). Both sides get the **same target range** from the generator (SCOPE divergence 4); U applies it through `$setSelection` + `removeText` |
| `FormatText(bit)` | bold, italic, underline, strikethrough, code, subscript, superscript, highlight, lowercase, uppercase, capitalize | |
| `PatchStyle {prop, value}` | `$patchStyleText` | |
| `InsertParagraph`, `InsertLineBreak`, `InsertTab` | | |
| `SetBlocksType(kind)` | paragraph, h1–h6, quote, code | `$setBlocksType` |
| `Indent`, `Outdent` | | lists and `canIndent` paragraphs |
| `InsertList(bullet\|number\|check)`, `RemoveList`, `ToggleChecked` | | |
| `InsertTable {rows, cols, headers}`, `InsertRow {after}`, `InsertColumn {after}`, `DeleteRow`, `DeleteColumn`, `MergeCells`, `UnmergeCell`, `ClearCells` | | `ClearCells` exercises the `$clearText` patch in the macro profile |
| `ToggleLink(url\|null)`, `AutoLinkText` (types a URL then a space) | | |
| `WrapComment(id)`, `UnwrapComment(id)` | `$wrapSelectionInMarkNode`, `$unwrapMarkNode` | the comment-only gate's input |
| `PasteNodes(json)` | serialized nodes from `$generateJSONFromSelectedNodes` of a random slice of the current doc, or a corpus fragment | `$insertGeneratedNodes` |
| `PasteMarkdown(md)` | md generated from a grammar (headings, lists to 4 levels, quotes, fences, tables, inline formats, links, Macro mention tags) | `$convertFromMarkdownString` into the selection |
| `MarkdownShortcut(trigger)` | `# `, `## `, `> `, `- `, `1. `, `[ ] `, ```` ``` ````, `**x**`, `*x*`, `` `x` ``, `~~x~~`, `---` typed at a valid position | U runs `registerMarkdownShortcuts` and is compared after its enqueued update drains. R runs shortcuts inside `apply`. U's `_cascadeCount` drop is patched out of the oracle (§3.1, D4) |
| `Undo`, `Redo`, `Tick(ms)` | `Tick` advances the shared clock 0–2,000 ms | merge heuristics |
| `SetEditorState` | `parseEditorState(toJSON())` round trip | must be a no-op on both |
| `Composition {start, update(s), end}` | composition key on a text node; the updates go through `TextFromView` with `composition_data` | normalization must skip the composing node |
| `Remote(peer, ops)` | (M2) apply a random command on a second Loro peer, import into both | §3.5 |

**Production input path (D1).** These are the inputs every real keystroke uses, and they
carry at least as much weight as `InsertText`:

| Command | Generator | U | R |
| --- | --- | --- | --- |
| `TextFromView {key, text, anchor, focus, compositionEnd, compositionData, selection}` | a text node of the current state; `text` = its text with a random edit applied at the selection (insert 1–3 chars from the `InsertText` alphabet, delete a range, replace a range, an autocorrect-style word replacement); offsets after the edit, including inside surrogate pairs; `compositionEnd` in 10% | jsdom root (§3.1): set `nodeValue` + DOM selection, dispatch `input` | `Input::TextFromView` |
| `SelectionFromView {anchor, focus}` | random DOM points: text, element, and the DOM-only shapes upstream normalizes (a point inside a decorator's DOM, on a line break, on the root element) | set DOM selection, dispatch `selectionchange` | `Input::SelectionFromView` |
| `Batch(keydown, beforeinput, input, selectionchange)` | one keystroke as a host delivers it | the same events, one tick | `Input::Batch` |

**Command-bus and remaining model behaviours (D2).** Each is dispatched through
`dispatchCommand` on U and `Input::Command` on R, so the rich-text, list, table and code
handlers run, not the selection method directly:

| Command | Notes |
| --- | --- |
| `KeyEnter {shift}`, `KeyBackspace`, `KeyDelete`, `DeleteCharacter {backward}` via `DELETE_CHARACTER_COMMAND` | through rich-text, list (`LST-KEY`), table (`TBL-KEY`) and code handlers; Backspace at block start outdents (`RT`) |
| `KeyTab {shift}` | in code (`CODE-KEY`), list and table cell |
| `KeyArrow {dir, shift}` | at table edges (`TBL-KEY`), around inline decorators (`MOVE_TO_START/END`, the `RichTextInlineDecoratorMoveTo*` cases), into and out of code |
| `KeyEscape` | `KEY_ESCAPE_COMMAND` (Macro P0) |
| `DeleteWord {backward}`, `DeleteLine {backward}` | the target range is supplied (SCOPE divergence 4), and the command goes through the bus |
| `NodeSelectionDelete`, `NodeSelectionEnter`, `NodeSelectionType(s)` | NodeSelection over a decorator (`RichTextNodeSelectionEnter`) |
| `InsertDecorator {inline\|block}` | `$insertNodeToNearestRoot`, and `$insertNodes` of a block into mid-text |
| `TableSelectionFormat(bit)`, `TableSelectionInsertText(s)`, `TableSelectionDelete` | over a TableSelection (`TBL-SEL`) |
| `FormatElement(align)` | `FORMAT_ELEMENT_COMMAND` |
| `CodeMoveLines {up}`, `CodeSetLanguage(lang)` | `CODE-KEY` move lines (Alt+Arrow), language change |
| `SetNodeState {key, value}` | NodeState set on a random node, including Macro's `$.id`/`$.peerId` keys (`NS`) |
| `ClearEditor`, `ClearHistory`, `UpdateWithTag(history-merge\|history-push)` | `HIS-63/64`, tags |
| `Copy` | **R's copy is compared with U's**: `$generateJSONFromSelectedNodes` and `$getTextContent` of the selection on both, JSON and plain-text payloads (CLP export half) |
| `DropMove` | rich-text drop of a Lexical drag (move, not copy; audit-r1-B C-7) |
| `SetEditable(false)` then any command | read-only behaviour |
| `ParseForeign(json)` | `parseEditorState` of foreign JSON (R's profiles leave `opaque_unknown_types` off, so an unknown type errors on both sides as upstream does): unknown types, old `version`s, legacy CodeHighlightNodes, §3.6b synthetic documents. Real Macro documents are used only in the nightly corpus job, which has dev credentials and never writes content to CI output (§3.6) |
| `NestedEditor(cmd)` | a command inside a decorator's nested editor that shares history with the parent (`HIS-42`, `HIS-80..83`) |

Weights: `Select` + `InsertText` 20%, `TextFromView` 20%, `SelectionFromView` 5%,
`Batch` 5%, `DeleteCharacter`/`KeyBackspace`/`KeyDelete` 15% together, and every other
command 1–3%. A precondition skips a command when it has no valid target.

### 3.2a Generator coverage floors (D3)

`diff/generator_coverage.test.ts`, the same shape as S8 §9, runs the per-PR seed list and
fails if any floor is missed:
- every command in §3.2 is **executed, not skipped**, in ≥ 0.5% of steps (≥ 0.2% for the
  1% commands);
- the state was in each of these regions before a step in ≥ 1% of steps: inside a table
  cell; inside code; list depth ≥ 3; inside a mark; adjacent to an inline decorator; in
  an RTL run; an astral character at the caret; a composition active; a NodeSelection; a
  TableSelection; read-only; a nested editor focused;
- ≥ 5% of runs reach an undo stack depth ≥ 20, and ≥ 1% reach `maxDepth` eviction
  (nightly only).

A generator change that silently stops reaching a region fails here.

### 3.3 Comparison and normalization

After every step, on both editors:

| Compared | Normalization |
| --- | --- |
| `toJSON()` | none for structure. Key-free by construction. NodeState ids compared directly (same seeded generator). `codeHighlight` (§1.7) only if U ran a highlighter, which the profiles don't |
| selection | type; anchor and focus as (DFS path, UTF-16 offset, point type); format; style; backward. NodeSelection as sorted paths. TableSelection as (table path, anchor cell, focus cell) |
| keys | bijection U↔R must stay consistent across steps, i.e. no key reuse. Strict string equality once the profile passes in strict mode |
| markdown | `$convertToMarkdownString` with each transformer set of the profile (upstream: `TRANSFORMERS`; macro: `INTERNAL_TRANSFORMERS`, `EXTERNAL_TRANSFORMERS`), plus `markdownToEmbeddingText` for macro |
| text content | `$getRoot().getTextContent()` |
| outcome | if U throws, R must return `Err` with the same message, and both states must equal the pre-step state. If U succeeds, R must succeed. After an `Err` the composition key is masked until the next successful step: R rolls it back, U keeps it (S1 §8.8, D-16, R2-18) |
| history | `canUndo`, `canRedo`, and the undo stack depth |
| commit contents (D5) | R's `Commit` dirty sets and `changes` vs U's `dirtyLeaves`/`dirtyElements` (captured from the update listener's arguments) and a node-map identity diff (created, updated, destroyed keys through the bijection); `normalized` keys; tags (`commit.tags` vs `updateTags`). Dirty sets as sets. These feed the Loro projection and the view diff |
| copy payload | after `Copy`: R's and U's JSON (`{namespace, nodes}`) and plain-text payloads |
| macro extras | `toXml(json)`, search text per block (lexical-service `/search` logic), comment-only gate verdict for the step when the step was a comment command |

The first mismatch fails the run, with a JSON-path diff and both states.

### 3.4 Shrinking into Tier A

- `fc.commands` + `fc.asyncModelRun` shrink as the #8309 fuzzer does.
- The shrunk command list is replayed once on U **through the Tier A recorder**. The
  recorder's membrane wraps the commands' `editor.update` bodies, and the result is
  written to `crates/client/lexical/lexical_conformance/fixtures/fuzz/<sha8>.json` with
  `source: {"repo": "fuzz", "seed", "path", "profile"}`.
- The fix PR commits that fixture, so every found divergence becomes a permanent
  native regression test with no hand work.
- Divergences that are upstream bugs we deliberately don't copy go on the ledger
  as `divergence-<n>`, with the fixture kept and marked `xfail`.

Budgets:
- per PR: 10k steps over a fixed seed list (the M0 exit criterion), plus 2k with
  `DIFF_TARGET=view`;
- nightly: 1M steps with fresh seeds (runs up to 5k steps), plus 200k with `DIFF_TARGET=shim`,
  and failing seeds are posted to the run summary;
- `DIFF_SEED`/`DIFF_PATH` replay one failure.

### 3.5 Collaboration (M2) and reuse of #8309

The existing browser fuzzer (`apps/web/src/lib/core/component/LexicalMarkdown/fuzz/`,
#8309) is reused in two ways:

1. **Model level.** `diff/` borrows its command-weighting and precondition style
   (`commands.ts`, `model.ts`) and its `fc.scheduler()` relay idea (`relay.ts`) for
   `Remote` commands. Each implementation has two peers. U-side peers use today's
   loro-mirror binding; R-side peers use `lexical_loro`. Messages flow through a
   scheduler shared by all four peers, so delivery order is part of the input. The checks:
   - after full delivery, the U-peer Loro docs and R-peer Loro docs are equal as
     `doc.toJSON()`;
   - the Lexical states on all four peers are equal;
   - `MARKDOWN_GOLDEN`-based snapshots are byte-identical.

   This is M2's differential exit criterion.
2. **Browser level, unchanged.** The #8309 fuzzer runs against the swapped editor
   (flag on) with its existing oracles (`oracles.ts`):
   - Loro convergence;
   - region models;
   - editor vs server markdown;
   - JSON vs Loro;
   - tree invariants;
   - no `console.error`.

   Its findings are compared against the same seeds with the flag off, and only *new*
   finding kinds fail. Today's known kinds come in through `FUZZ_IGNORE`.
3. **Collaborative undo, model level.** `Undo`/`Redo` on one peer of the four-peer relay,
   after interleaved edits by another peer: U-side peers undo through today's Loro
   `UndoManager` binding, R-side peers through `lexical_loro`'s undo grouping. Compared:
   the four Lexical states after delivery, and that the undone spans are only the undoing
   peer's own (the model-level twin of S8's `undo_reverts_only_own` invariant).

Session-level behaviours (presence, WAL, reset, framing, reconnect) are S8's: its R1
invariants `presence_converged`, `presence_expires` and `undo_reverts_only_own`, the
corruption faults (`Net(CorruptNext)`, `Storage(CorruptSnapshot)`,
`Server(CorruptSnapshot)`, `ClientBuild::Faulty`), large-document seeds, client golden
transcripts against today's TS stack, and the real-worker runs under Miniflare. S4 maps
them in the matrix (§8.3) and runs their browser halves (§6.2 E19–E22).

### 3.6 Real-document corpus (dev only)

- **Source:**
  - dev sync-service `GET /document/{id}/raw` returns the serialized state lexical-service
    already consumes;
  - ids are listed from dev MacroDB (markdown documents, plus collab surfaces, plus
    chat/channel messages that store Lexical JSON);
  - dev data is treated as real.
- **Storage:**
  - the fetch job writes to an encrypted cache outside the repo (`$XDG_CACHE_HOME/lexical-corpus/`
    locally, an expiring CI cache in the nightly job);
  - **no corpus content is committed, logged or attached to CI output.** Reports carry
    document id, route, JSON path of the first difference, and hashes.
- **Prod corpus** needs explicit permission and is out of this spec.

For each document, the runner (`corpus/run.ts`) calls the **current** lexical-service
code in-process (the same handlers, imported from `services/lexical-service/src`, with
no network) and the Rust implementation (`macro_document_model`, through a small
napi or wasm test binding). Each side uses the registry its route really uses: the doc-id
routes and the gate use lexical-service's `createEditor()` (no `NodeReplacements`), and
Rust uses the export registry (S3 CR-17); the composers and snapshots use
`headless_editor()` on both sides. It requires byte-identical output **after the
determinism inputs and masks below**, never silently normalized.

**Determinism first, masks last (A8, audit-r1-B Q20).** Both sides get the same injected
inputs, so most nondeterminism never reaches the output:
- a fixed clock (vitest fake timers on the JS side, `tx.now_ms()` on Rust), so
  DocumentMention `createdAt` (Q3) and SnapshotNode `snapshotDate` (P3-5) are
  **compared, not masked**;
- a seeded id generator on both sides for nanoid ids and nodeIdPlugin ids;
- the same `host` (`None` for server routes, Q8/Q9).

What remains is masked by `corpus/normalize.json`. Each mask has a name, a JSON-path or
regex, a reason linked to S3, and is applied **symmetrically**; the report prints the
count of masked fields per mask per route:

| Mask | Applies to | Reason |
| --- | --- | --- |
| `awaitId` | AwaitNode `awaitId` where the caller generates it outside the seeded generator | S3 Q20 |
| `frozenGoldenRootId` | the root id of `MARKDOWN_GOLDEN` | S3 Q20 |
| `html-tasklist-patch` | none once the JS `/html` fix lands (Q1); until then `/html` on documents with lists is **skipped and counted**, not compared | S3 Q1 |
| `legacy-agent-context` | `/agent-context` bodies with legacy fields (S3 R1 kept the cut, A-12): skipped and counted | audit-r1-B F2b-23 |

A mask that masks more than 0.1% of a route's documents is a failing report, not a pass.

**Node-type histogram (A6).** The fetch job also emits, for the whole corpus, a histogram
of node types and of serialized field names per type (types and counts only, no content).
The report lists every S3 node and field with zero occurrences; those are covered only by
the synthetic generator (§3.6b), and the release PR shows the list. The corpus includes
at least one document with a legacy `"type":"list"` and one with a legacy `"type":"code"`
node (synthetic if dev has none), because the export registry keeps them as ListNode and
CodeNode while `headless_editor()` replaces them (audit-r1-B P3-1).

**JS side fixes before comparison.** The `/html` list crash (S3 Q1, verified under Bun)
is fixed in lexical-service first (`typeof HTMLElement !== 'undefined' && …`), so both
sides produce comparable bytes. The comparison requires:

| lexical-service route | Callers | Inputs per doc | Compared |
| --- | --- | --- | --- |
| `GET /markdown/:docId?target=internal\|external\|embedding` | documents, collab_surface, agent_trigger, task_dedup, scheduled_action, skills | doc | the three markdown strings |
| `GET /search/:docId` | search_processing_service | doc | per top-level block: id, search text, block JSON |
| `GET /cognitionv2/:docId` | documents | doc | per-block markdown + image node list |
| `GET /comment-mark/:docId/:markId` | documents, agent_trigger, channel_bots | every comment mark id in the doc | `$getCommentMarkContext` output |
| `POST /comment-only-change` (sync-service gate) | sync-service | synthetic edit pairs per doc (below) | boolean verdict **and** the normalized JSON both sides compared |
| `POST /snapshot/markdown` | documents, collab_surface | the doc's internal markdown | the resulting Loro doc as `doc.toJSON()` (seeded peer and ids). Snapshot bytes are compared only for `MARKDOWN_GOLDEN` |
| `POST /snapshot/notion` | documents | the lexical-core notion fixtures + dev Notion imports' source md, if stored | as above |
| `POST /html` | email | the doc's internal markdown | HTML string, exact |
| `POST /mentions` | documents, agent_harness, lexical_mention_extractor | the doc's internal markdown | mention list |
| `POST /extract-reply`, `/agent-announcement`, `/agent-context`, `/image-markdown` | agent_trigger, agent_harness, image_generation | these take message markdown, not documents: use each doc's markdown as a message body, plus the lexical-core fixture inputs | output strings |
| `GET /plaintext/:docId`, `/cognition` (v1), `/xml/:docId` | none found | doc | compared once for completeness; dropped from M1 if still callerless |
| (no route) JSON round trip | everything | doc | `toJSON(parse(doc)) == doc` on both, and R == U |
| (no route) Loro snapshot export | M1 snapshot path | doc | `lexical_loro::snapshot(state)` vs loro-mirror snapshot, as `doc.toJSON()` |

**Comment-only gate edits.** These are generated per document with a seeded RNG, each as
`(before, after, expected)`, where `expected` is lexical-service's own verdict:
- (a) wrap a random range in a comment mark → allowed;
- (b) unwrap an existing mark → allowed;
- (c) wrap a range that splits a formatted text node, so normalization must re-merge →
  allowed;
- (d) change one character → rejected;
- (e) toggle a format bit → rejected;
- (f) move a block → rejected;
- (g) edit inside a draft mark → per current rule.

- (h) rewrite a `code` node as `custom-code` with the same text, or a `list` as
  `task-list` → rejected by JS (audit-r1-B F2b-8; the export registry has no
  replacements);
- (i) change a `code` node's `language` → rejected;
- (j) wrap a range inside a list item with `checked:false` in a bullet list → JS verdict
  (node-intrinsic transforms run, F2b-9).

R must reproduce every verdict, because a divergence here grants or denies edit rights
(SCOPE Risks).

### 3.6a Comment-only gate: differential and adversarial fuzzing (A9)

Attackers send arbitrary Loro updates, not editor commands, so the gate is fuzzed on its
inputs directly. `packages/lexical-conformance/diff/gate-fuzz/`:

- **Oracle.** lexical-service's `isCommentOnlyChange` (`lib/comment-only-change.ts`)
  in-process, with its own `createEditor()`. The verdict includes "throws" (a state that
  does not parse), which must be an `Err` on R.
- **System under test.** `macro_document_model::gate::is_comment_only_change` through the
  wasm binding, built as sync-service links it (`default-features = false`).
- **Seeds.** The 12 cases of `comment-only-change.test.ts`, every corpus document (the
  §3.6 pairs), and synthetic per-node documents (§3.6b).
- **Mutations of `after`** (each a generator; several compose per case):
  text-node splits and merges; format and style bits; mode and detail; NodeState changes
  on identity keys (`id`, `peerId`, `sharedPeerIds`, `local`, which the gate strips) and on
  other keys (which it keeps); comment-mark id swaps and overlapping ids; a mark moved
  across blocks; text changed inside a newly added mark; a mark wrapping a decorator;
  legacy CodeHighlightNode children collapsed or expanded (D6); `code`→`custom-code` and
  `list`→`task-list` type rewrites; unknown node types; extra or missing keys; key-order
  permutations (must not change the verdict: `isDeepStrictEqual`); numeric vs string
  values; very deep nesting.
- **Loro level.** Random Loro ops on a document's LoroDoc → the `sync_server_core`
  projection → `(before, after)` JSON → both gates. This is the path a hostile client
  takes (S6).
- **Property.** For every case, R's verdict == JS's verdict, and when both accept, the
  normalized JSON both sides compared is equal. Any accept-vs-reject difference is a
  release blocker; a found case is shrunk and committed as a literal test in
  `macro_document_model/tests/gate.rs`.
- **Budget.** Per PR: fixed seeds, 20k cases. Nightly: 1M cases with fresh seeds.

The first test of `tests/gate.rs`, written out in full. Its shape follows
`comment-only-change.test.ts` "accepts wrapping text in a comment mark"; the expected value
was obtained by running lexical-service's `isCommentOnlyChange` on exactly these two
literals:

```rust
/// upstream: services/lexical-service/src/lib/comment-only-change.test.ts
/// "accepts wrapping text in a comment mark" (same scenario, one paragraph)
/// covers: S3:route:8, S3:node:CommentNode, S3:CR-17
#[test]
fn wrapping_text_in_a_comment_mark_is_comment_only() -> Result<(), Box<dyn std::error::Error>> {
    let before = json!({"root": {
        "$": {"id": "root-1"}, "type": "root", "version": 1, "format": "", "indent": 0,
        "direction": null,
        "children": [{
            "$": {"id": "para-1", "peerId": "author"}, "type": "paragraph", "version": 1,
            "format": "", "indent": 0, "direction": null, "textFormat": 0, "textStyle": "",
            "children": [{
                "$": {"id": "text-1", "peerId": "author"}, "type": "text", "version": 1,
                "text": "Run it twice.", "format": 0, "detail": 0, "mode": "normal",
                "style": ""}]}]}});
    let after = json!({"root": {
        "$": {"id": "root-1"}, "type": "root", "version": 1, "format": "", "indent": 0,
        "direction": null,
        "children": [{
            "$": {"id": "para-1", "peerId": "author"}, "type": "paragraph", "version": 1,
            "format": "", "indent": 0, "direction": null, "textFormat": 0, "textStyle": "",
            "children": [
                {"$": {"id": "text-1", "peerId": "author"}, "type": "text", "version": 1,
                 "text": "Run it ", "format": 0, "detail": 0, "mode": "normal", "style": ""},
                {"$": {"id": "mark-1", "peerId": "commenter"}, "type": "comment-mark",
                 "version": 1, "format": "", "indent": 0, "direction": null,
                 "ids": ["thread-1"],
                 "children": [
                     {"$": {"id": "text-9", "peerId": "commenter"}, "type": "text",
                      "version": 1, "text": "twice", "format": 0, "detail": 0,
                      "mode": "normal", "style": ""}]},
                {"$": {"id": "text-10", "peerId": "commenter"}, "type": "text", "version": 1,
                 "text": ".", "format": 0, "detail": 0, "mode": "normal", "style": ""}]}]}});

    assert!(gate::is_comment_only_change(&before, &after)?);
    Ok(())
}
```

### 3.6b Synthetic per-node generator (A6)

Several Macro nodes are editor-session nodes that stored documents rarely contain
(`BookingLinkMentionNode`, `CompletionNode`, `DecoratorBlockNode` subclasses,
`DiffNode`/`DiffInsertNode`/`DiffDeleteNode`/`DiffTextNode`, `InlineSearchNode`,
`SearchMatchNode`, `ThemeMentionNode`, `HorizontalRuleNode`, `ImageNode`/`VideoNode`), and
lexical-core's own tests name some of them in at most one file. So the corpus cannot be the
only per-node check.

`packages/lexical-conformance/corpus/synthetic.ts` generates, for **each of the 41 S3
nodes and each upstream node of the profile**, documents that exercise every serialized
field: each field present with representative values (empty string, unicode, astral,
long), absent where JS `importJSON` reads it without a default (P3-4), and `null` where JS
round-trips null (P3-6); nested in a paragraph, a list item, a table cell and a quote where
the node is allowed there. Each document runs through, with R == U:

| Route | Compared |
| --- | --- |
| JSON round trip | `toJSON(parse(doc))`, key order kept |
| markdown internal, external, embedding | strings |
| markdown import of the exported markdown | JSON |
| XML (`toXml`) | string |
| HTML (`/html` path) | string |
| search (`/search`) | per-block id, text, raw JSON |
| cognitionv2 | per-block markdown and images |
| Loro snapshot | `doc.toJSON()` |
| gate | `(doc, doc)` accepted; `(doc, doc with one field changed)` per field, JS verdict |

**M1 gate:** every node has at least one passing case per route; the coverage report lists
`(node, field, route)` triples with no case. The generator runs per PR (fixed seed, ~2k
documents) and nightly (fresh seeds). Its seeds also feed Tier C (§3.1) and e2e E18
(render equivalence).

### 3.6c Regex and matcher differentials (audit-r1-B R-1, Q19)

regress 0.12 folds the `i` flag with Unicode simple case folding; V8's non-`u`
Canonicalize refuses non-ASCII → ASCII mappings (ES2024 §22.2.2.7.3), so `/s/i` matches
`ſ` (U+017F) in regress and not in V8. `diff/regex-differential/`:

- **Inventory.** Every regex static in `lexical_markdown` and
  `macro_document_model::transformers` (S3 §4.2.3, §4.2.6), the hashtag regex, the
  autolink matchers and `TAG_START_REGEX`/`TAG_END_REGEX`, with flags. A build script
  emits the list from the Rust source; the test fails if a regex is missing from the
  JS side's list (recorded from lexical-core and upstream by name).
- **Inputs.** A fixed corpus containing U+017F, U+212A, U+0130, U+0131, U+1E9E, U+03C2/
  U+03A3/U+03C3, U+0345, U+FB00..FB06, Cherokee (U+13A0..), astral letters, combining
  marks, lone surrogates (JS side only; Rust gets U+FFFD and the case is ledgered
  `lone-surrogate`), plus every markdown snippet of the A-rec markdown fixtures; nightly adds
  fast-check strings over the same alphabet.
- **Property.** For every regex and input: the match spans (`exec` loop with `lastIndex`
  for `g`/`y`, capture groups included) from V8 (node) equal the spans from the Rust
  `RegexMatcher` wrapper, in UTF-16 units.
- **First test, literal:** `regex::s_with_i_flag_does_not_match_long_s` asserts
  `RegexMatcher::new("s", "i")?.find("ſ") == None`, with V8's `null` in the comment.
- **linkify-it (Q19).** The same harness compares the Rust linkify-it port with
  linkify-it 5.0.2 (`match()`, `test()`, `pretest()`) over URL-heavy fast-check strings,
  TLD edge cases and the auto-link fixtures; the first literal test pins the candidate
  merge order of F2a-15.

### 3.7 Shadow mode (M1)

- Shadow mode lives in the Rust callers' adapter: the `crates/lexical_client` port
  implementation, or the new `macro_document_model` adapter behind the same port.
  - With `LEXICAL_SHADOW=sample:<rate>` (a backend config switch, CS-14),
    each call also runs the native Rust implementation **after** returning the
    lexical-service result.
  - It compares, and on mismatch emits a `lexical.shadow.compare` span with
    `route`, `document_id`, `diff_path`, `lexical_service_hash`, `rust_hash`, `outcome`.
    It never emits content (observability rule).
  - A counter feeds a Datadog monitor.
  - The differ uses the same registries (export registry for doc-id routes and the gate)
    and the same `corpus/normalize.json` masks and counted skips as §3.6 (legacy
    agent-context bodies per A-12, `/html` before the Q1 JS fix). A skip emits
    `outcome = "skipped"` with the mask name, so skips are counted, never silent.
- sync-service runs the gate in-process **and** over HTTP, and logs disagreement the
  same way. The HTTP verdict stays authoritative until the flip.
- Rollout:
  1. dev at 100%;
  2. prod only with D8 approval.
- Exit per route group: 7 days and ≥ 10k compared calls (or every call, if fewer) with
  zero mismatches. That is the last gate before each caller flip (SCOPE M1 order:
  markdown export → import/snapshots → gate → composers → html).

---

## 4. Rust-native property tests (`proptest`, `lexical_model` only)

`crates/client/lexical/lexical_model/tests/props.rs` (sibling test file, CS-49). The
generators are:
- `arb_state()`: a random tree over Root, Paragraph, Heading, Quote, ListItem-free
  elements, Text with random format, style and mode, LineBreak, Tab, and a test
  decorator;
- `arb_command()`: a `proptest` strategy (`prop_oneof!`) over the same `Command` enum as
  Tier C, written in the test crate: S1 defines no `testing` feature, and `Arbitrary` cannot
  be derived on the foreign type;
- `arb_script()`: a state plus up to 64 commands.

The properties need no oracle. Each runs after every commit in the script:

| # | Invariant |
| --- | --- |
| P1 | Links are consistent: `parent`, `prev`, `next`, `first`, `last` and `size` agree for every node; root has no parent; there are no cycles |
| P2 | Every key in the committed map is reachable from root; detached nodes are GC'd |
| P3 | Normalized text: no empty simple text node and no two adjacent mergeable simple text nodes (same format, style, mode and detail, `nodeStatesAreEquivalent`), except the composing node |
| P4 | Selection validity: anchor and focus keys exist and are attached; a text offset is ≤ the node's UTF-16 length and never splits a surrogate pair; an element offset is ≤ `size` |
| P5 | Caches: each text node's cached UTF-16 length equals its recount; the root text-content cache and element `textFormat`/`textStyle` equal recomputation from scratch |
| P6 | JSON round trip: `export(import(export(s))) == export(s)`, and `import(export(s))` is structurally equal to `s`, ignoring keys |
| P7 | Rollback: a `Transaction` that returns `Err` or is dropped leaves the editor's state `Arc::ptr_eq` to the previous one |
| P8 | Persistence: the previous `EditorState` is unchanged, byte for byte in its JSON, after the next commit |
| P9 | The diff is complete: applying `Output::diff` (`Commit::diff(&DiffOptions)`, spanning the `preceding` chain) to a model of the previous view tree yields the next tree |
| P10 | `Commit.changes.mutations` (`Created`, `Updated`, `Destroyed`) equals a brute-force diff of the two node maps |
| P11 | History: undo after a script restores the state at the last history boundary; `redo ∘ undo` is the identity on the JSON |
| P12 | Transforms terminate: a registered transform that always dirties its node yields the infinite-transform `Err` (upstream's message), never a panic or hang |
| P13 | Keys are deterministic: the same script from the same seed yields the same key strings |
| P14 | Markdown export is deterministic, and `export(import(md))` is a fixpoint after one round, for the node subset where upstream also has that property. Counterexamples are checked against upstream through Tier C before being filed |

`PROPTEST_CASES` is 256 per PR and 20,000 nightly. Failure persistence files
(`proptest-regressions/`) are committed. Any counterexample that upstream also produces
is checked through the Tier C harness and becomes a Tier A fuzz fixture instead.

---

## 5. Perf gates

"Typing is at least as fast as upstream" is a claim about what a user sees: the time from
a key press to the frame that shows the glyph, in the editor Macro ships. R0's harness
timed `editor.update` + `editor.read` + four microtasks back to back in one task, never
painted, and drove input without `keydown`/`keyup`. R1 measures the user-visible latency,
with a statistical design that can resolve a 3% effect, and adds noise-free companion
gates that run on any machine.

### 5.1 Harness

`bench/` is ported to `packages/lexical-conformance/bench/`, and its scripts keep their
names (`gen-docs.mjs`: deterministic S/M/L docs of 2.2 KB / 50 KB / 500 KB markdown, 190 /
3,835 / 36,530 nodes; `run-browser.mjs`: Bun server with COOP/COEP; `run-browser-trace.mjs`;
`analyze-cpuprofile.mjs`).

**Two cells, both gated, named explicitly (F3).**

| Cell | Editor | Plugins | Answers |
| --- | --- | --- | --- |
| `core` | `EDITOR=upstream`: production `lexical@0.45.0` (`--conditions=production`). `EDITOR=rust`: the same entry with `lexical` aliased to the shim on its `conformance` backend and `lexical_conformance_wasm` (`--target web`, release, `wasm-opt -O3`, §2.8). The shipped `document_session_wasm` is measured by the `app` cell | the `macro` variant only: rich-text, list, markdown shortcuts, history, `registerMarkdownEditing`, the Loro binding. The plain variant runs as a diagnostic, ungated | G2's literal wording: the Rust core vs upstream |
| `app` | the real Macro document editor, flag off vs flag on (`rust-editor-model`), production build served by the bench server, documents S/M/L seeded through the API | the ~60 production plugins | "at least as fast for users": plugins that walk the tree call node getters over wasm (SCOPE §3.3), which is where a regression would come from |

**Input, as a user produces it (F1).**
- Keys are sent with CDP `Input.dispatchKeyEvent`: `keyDown` with `text` (and `key`,
  `code`, `windowsVirtualKeyCode`), then `keyUp`. That fires `keydown` →
  `beforeinput` → `input` → `keyup` → `selectionchange`, so `KEY_DOWN_COMMAND`, Macro's
  typeahead and keyboard plugins, the DOM-first fast path and the single `TextFromView`
  crossing (SCOPE §3.4) are what's measured. `Input.insertText` (R0's `input` mode) is
  kept only as a diagnostic.
- Two cadences:
  - **realistic:** one keystroke every 80 ms, so each keystroke gets its own frame;
  - **burst:** eight keystrokes inside one 16 ms frame, to measure coalescing.
- The target paragraph rotates every 50 keystrokes among paragraphs at the same depth
  (F8), so no single text node grows by 1,000 characters.

**The metric: input → presented frame (F1).** Taken from a Chrome trace with categories
`input,benchmark,cc,devtools.timeline,disabled-by-default-devtools.timeline.frame`, per
keystroke, from `EventLatency` events (keyed by the `keydown`'s trace id): total latency
from the hardware timestamp to presentation of the first frame that contains the glyph,
plus the processing and presentation sub-stages. Also recorded per keystroke:
- main-thread handler time: the sum of `EventDispatch` durations for `keydown`,
  `beforeinput`, `input`, `keyup` and `selectionchange`;
- forced style and layout time inside those handlers (`Layout`/`UpdateLayoutTree` with a
  JS stack);
- dropped frames at 12 and 30 characters per second (realistic cadence at 83 ms and 33 ms).

The Event Timing API is not used (its `duration` is rounded to 8 ms). R0's in-page model
timing (`benchKeystroke`) stays as a secondary diagnostic, with its defects fixed (F8):
`sampleAsync` takes a fixed sample count with no time cap and fails if the count isn't
reached; `drain` loops until `editor._pendingEditorState === null` and no update is
queued, not four microtasks.

**Bulk and startup** use the same server: md import, md export, `toJSON`,
`parseEditorState(obj|string)`, initial load (md import + first reconcile, JSON load + first
reconcile), paste 50 KB markdown into the middle of L and undo it, select-all + delete,
`setEditorState` swap, wasm compile + instantiate, and (app cell) **document open**: from
navigation to the editor being editable and painted (first `EventLatency`-free frame after
the editor's `data-lexical-editor` root has content and `contenteditable=true`).

### 5.2 Statistics (F2)

The tolerances are 3% (p50) and 5% (p95). At S the p50 is about 0.18 ms of model time but
several ms of input → frame; the design below resolves 3% on input → frame, and the
companion gates cover what wall time can't.

1. **Unit of replication.** One *round* is a fresh browser context on its own origin
   (`u.localhost` vs `r.localhost`, so the renderer processes differ), one editor, 50
   warmup keystrokes, then 400 (S, M) or 300 (L) measured keystrokes. The previous round's
   context is closed before the next starts. Statistics are per round: p50 and p95 of the
   per-keystroke metric.
2. **Design: randomized pairs.** Each *pair* is one U round and one R round in random order
   (seeded coin per pair, recorded). Per pair and statistic, `d_i = ln(stat_R / stat_U)`.
   Pairs cancel slow drift (thermal, background load).
3. **Isolation.** Gate runs happen on a **bare-metal** runner: the browser and its renderer
   pinned to dedicated cores (`taskset` or a cgroup cpuset), `cpupower frequency-set -g
   performance`, turbo off, SMT siblings idle, no other jobs, Chrome from Nix with fixed
   flags, fixed 1280×720 viewport, device scale factor 1, headed under Xvfb (chosen once,
   fixed). A shared VM (`namespace-profile-linux-large`) produces the trend line only, never
   a gate verdict. If no bare-metal CI runner exists at M3, the wall-time verdict comes from
   a dedicated machine with the same settings, named in the M3 exit PR, with its
   calibration file committed.
4. **Calibration (A/A).** Before the first gate run, and after any runner or Chrome change:
   at least 50 A/A pairs (U vs U) per cell × size × cadence × statistic. They estimate
   `σ_d` and validate that the decision rule below has a false-fail rate ≤ 1% at a true
   ratio of 1.0 (counted over the A/A pairs by resampling). `bench/calibration/<runner>.json`
   is committed.
5. **Sample size.** Per cell, `n = ⌈((z₀.₉₇₅ + z₀.₈) · σ_d / δ)²⌉` pairs, where
   `δ = ln(1.03) ≈ 0.0296` for p50 and `ln(1.05) ≈ 0.0488` for p95, and `σ_d` comes from
   calibration (`z₀.₉₇₅ + z₀.₈ ≈ 2.80`). Examples: `σ_d = 0.04` → n = 15; `σ_d = 0.08` →
   n = 57. **Minimum 30 pairs** per cell whatever the formula gives.
6. **Decision.** On the paired mean `d̄` with a 95% CI (t interval; BCa bootstrap over
   pairs, never over pooled keystrokes, when the Shapiro–Wilk test on `d_i` rejects):
   - **pass** if the CI's upper bound < `δ`;
   - **fail** if the CI's lower bound > `δ`;
   - otherwise **inconclusive**: extend to 2n pairs with a pre-registered second look at
     Pocock-adjusted α ≈ 0.029 per look, then decide pass or fail on the same rule. A second
     inconclusive is a fail.
7. **Stationarity.** Within each round, regress the metric on keystroke index. A slope
   significant at 1% in more than 10% of R rounds (and not in U rounds) is reported as a
   growth or leak finding, separately from the ratio, and fails the memory gate's review.
8. **Noise-free companion gates** (per PR, any machine):
   - **instructions per keystroke** on the renderer main thread: Chrome
     `--enable-thread-instruction-count` with trace `ThreadInstructionCount` deltas per
     `keydown` dispatch through presentation (or `perf stat -e instructions` on the
     renderer pid where perf is allowed). Gate: R/U ≤ 1.02 at each size and cadence,
     paired median over 10 rounds;
   - **work counters** (`lexical_model` `bench-counters` feature, F6): nodes visited, nodes
     cloned, bytes allocated (counting allocator), diff ops emitted, per keystroke;
   - **boundary counters** (§2.4 item 10): wasm export calls and boundary bytes per
     keystroke.

   Wall-time gates run nightly on the gate runner and at milestones.

### 5.3 Metrics

| Metric | Cells, docs | Source |
| --- | --- | --- |
| input → presented frame, p50 and p95, realistic and burst | core + app; S, M, L | trace `EventLatency` |
| main-thread handler time; forced layout per keystroke | core + app; S, M, L | trace `EventDispatch`, `Layout` |
| dropped frames at 12 and 30 cps | app; M, L | trace frame events |
| instructions per keystroke | core + app; S, M, L | `ThreadInstructionCount` |
| work counters per keystroke | core; S, M, L | `bench-counters` |
| wasm export calls and boundary bytes per keystroke | core + app; S, M, L | shim counters |
| model time (`apply()` on R, `$beginUpdate` inclusive on U) | core; S, M, L | diagnostic only; `criterion` natively for absolute µs |
| bulk ops (§5.1) | core; M, L | `benchMarkdown`, `benchJSON`, trace |
| document open (navigation → editable and painted) | app; S, M, L | trace + `performance.mark` from the app |
| headless keystroke (lexical-service shape) | node; S, M, L | node, plus `criterion` natively for R |
| memory (§5.4 F4 rows) | core + app; L | `performance.measureUserAgentSpecificMemory()` + `WebAssembly.Memory.buffer.byteLength` |
| wasm size raw / gzip -9 / brotli -q11; compile + instantiate | build | build step + `WebAssembly.compileStreaming` timing |
| sync-service Worker bundle size (with `macro_document_model` linked) | build | `wrangler deploy --dry-run --outdir` size, compressed |
| ai-editing-worker CPU ms per replayed edit session | node / workerd | the testbench replay (M4) |

Memory is measured with `measureUserAgentSpecificMemory()` under cross-origin isolation,
Chrome launched with `--enable-blink-features=ForceEagerMeasureMemory` (otherwise results
arrive up to 20 s late), and `WebAssembly.Memory.buffer.byteLength` recorded alongside.

### 5.4 Thresholds

| Gate | Fails when |
| --- | --- |
| input → frame p50, each cell × size × cadence | the §5.2 decision rule fails with `δ = ln 1.03` |
| input → frame p95, each cell × size × cadence | the §5.2 decision rule fails with `δ = ln 1.05` |
| dropped frames at 12 cps (app, M, L) | R drops more frames than U in the paired comparison (one-sided sign test over pairs, α = 0.01) |
| instructions per keystroke (per PR) | paired median R/U > 1.02 |
| work counters (F6, per PR) | for a plain character in the middle of a paragraph, **any** count grows from S to L (the gate is 0 growth: no O(doc) work on the path) |
| boundary (C6, per PR) | > 2 wasm export calls or > 256 boundary bytes per plain character in the realistic cadence (`TextFromView`, plus `takeOutput` only when presence changed; S7 §7), at every size; and the count is the same at S, M and L |
| memory after loading L (F4) | `R_total` (JS heap + wasm memory) > 1.10 × `U_total` |
| memory under typing (F4) | after 10k keystrokes + 200 undo/redo pairs on L: growth over the post-load baseline > 5%, or a positive slope over the last 2k keystrokes (memory sampled every 250) |
| memory across documents (F4) | after opening and closing 20 documents in one tab (app cell): JS heap or wasm memory not within 2 MB of the first close, `debug_live_editors() != 0`, or a `FinalizationRegistry` count shows an uncollected shim handle after a forced GC (`HeapProfiler.collectGarbage`) |
| bulk ops at M and L (F7) | the upper 95% CI bound of the paired ratio (§5.2 method, δ = 0) is ≥ 1.00. The claimed wins are gated: md import at L and `parseEditorState` at L each ≤ 0.5 (upper CI bound) |
| headless keystroke at L | R > U; the target is under 1 ms, against 8 ms in Chrome and 16–26 ms in node/bun |
| document open, app cell, L | the §5.2 rule fails with `δ = ln 1.05` |
| wasm brotli size | > the provisional D5 cap of **1,130,000 bytes** for document_session_wasm; subject to tightening; WP-59 measures real startup cost |
| wasm compile + instantiate | > 50 ms on the gate runner (main-thread, startup-critical) |
| sync-service Worker bundle | compressed size leaves < 20% headroom under the account's Cloudflare Worker size limit |
| ai-editing-worker CPU (M4) | CPU ms per replayed session > upstream's on the same testbench cases (paired, §5.2 rule with δ = ln 1.05) |

R0's "1.03/1.05 are the measured noise" is withdrawn: those numbers were never measured on
a dedicated runner. They are now tolerances (`δ`), and the noise is measured by
calibration (§5.2 item 4), which decides n. "No worse than upstream" means passing the
equivalence-style rule at that δ.

### 5.5 iOS WKWebView (F5)

WKWebView runs JS and wasm in a separate **WebContent** process, so app-process APIs
(`os_proc_available_memory`, R0) measure the wrong process.

- **Prerequisite (M3 entry, not exit).** Verify that the Tauri custom scheme can serve
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp`, and that `crossOriginIsolated === true` in the WebView. Without it WebKit
  coarsens `performance.now()` to 1 ms, and per-keystroke timing is impossible. If it can't
  be served, iOS timing uses only batch timing (below).
- **Timing.** Batches: N = 50 keystrokes per measured block, block time / N. Keys are
  synthesized by a debug Tauri command that injects `UIKeyCommand`-equivalent input to the
  WKWebView (or, in the simulator, XCUITest `typeText`), with an `os_signpost` interval
  around each block, read in Instruments. Paired randomized design as §5.2 (U and R pages on
  separate origins, random order per pair, ≥ 30 pairs).
- **Memory.** WebContent process: Instruments/`xctrace` Allocations + VM Tracker attached
  to the WebContent pid, or the Safari Web Inspector Memory timeline (trace runs only).
  Reported: footprint after loading L, after the typing script of §5.4, and after 20
  document open/close cycles.
- **Nightly trend (simulator).** An XCUITest target (`BenchUITests`, added to the Xcode project Tauri generates for `apps/web/tauri/src-tauri`)
  boots the iOS simulator, opens the hidden `/app/__bench` route, runs the batch timing and
  memory script for U and R, and uploads `results/ios-sim/<date>.json`. Simulator numbers
  are a trend, never a gate.
- **Devices (release checklist, M3 exit and each Lexical bump after M3).** The oldest
  device that supports the deployment target (`IPHONEOS_DEPLOYMENT_TARGET = 15.0`) and the
  current base iPhone: plugged in, unlocked, full charge, low-power mode off, cold (5 min
  idle). Same metrics; the same ratio thresholds as §5.4 against upstream on the same
  device. Absolute numbers are reported, not gated (JSC was 1.5–3× slower than V8 on bulk
  ops). Results go to `bench/results/ios/<date>-<device>.json` and the M3 exit PR.
- **Build.** The release wasm is copied explicitly, because Tauri builds skip `build-wasm`
  (SCOPE Risks). The bench route is compiled out of production builds.
- **CSS Custom Highlight API fallback (D6).** Code highlighting uses the Custom Highlight
  API, which needs Safari 17.2+; the deployment target is iOS 15.0. On iOS 15 and 16
  (simulator runtimes, nightly), a test opens a document with a code block, types in it,
  and asserts no exception and either no highlighting or the span fallback, per the D6
  decision.
- First-keystroke latency after load (JSC tier-up, BBQ → OMG) and `compileStreaming` time
  are reported per device.

### 5.6 Android WebView (F5)

Macro ships an Android app (docs/development/android.md).
- **Nightly trend:** an Android emulator (x86_64, a fixed system image and WebView version)
  runs the same `/app/__bench` route inside the app's WebView, driven by a UIAutomator test
  that types through `adb shell input keyevent`/`input text` in batches; U and R paired as
  §5.2. Timing from CDP over `adb forward` to the WebView's DevTools socket
  (`EventLatency` works there), memory from `dumpsys meminfo` of the WebView renderer
  (`sandboxed_process`) pid.
- **Release:** one mid-range physical device in Firebase Test Lab (or a local device),
  same script, ratio thresholds as §5.4, absolute numbers reported.

### 5.7 Outputs

`results/<sha>/<cell>-<doc>-<cadence>.json` holds per-keystroke arrays per round, the pair
order, the trace file names, and the counters. A failing gate attaches the traces of the
two worst pairs. The trend is uploaded nightly.

---

## 6. Browser e2e (Playwright, swapped editor)

### 6.1 Setup

- Location: `apps/web/src/lib/core/component/LexicalMarkdown/browser-test/`, next to
  `fuzz/`, with its own `playwright.config.ts` like the other `browser-test/`
  directories. Surface scenarios (§6.3) live next to their feature's existing
  `browser-test/` and import nothing from a shared helper module beyond the persona login
  that the other suites already use.
- **Stack.** `just run_local --no-doppler` (docs/development/running-locally.md), then
  `just seed-scenario apply --file seed/scenarios/team-perms.json`.
  - Personas log in through the printed links (`http://alice.localhost:3000/app/login?email=alice@seed.macro.local`).
  - Each persona hostname has its own cookie jar, so two-user collab is two browser
    contexts on `alice.localhost` and `bob.localhost` against one stack.
- **Editor model.** It is selected by a `defineFlag` flag (`rust-editor-model`, per the
  feature-flags skill). The local override is `VITE_ENABLE_RUST_EDITOR_MODEL`, declared
  in `vite-env.d.ts`. Every scenario runs **twice**, flag off and flag on, as a
  Playwright project parameter.
- **Model oracle.** A debug hook (`window.__macroEditorDebug`, dev builds only) returns
  `{json, markdownInternal, selection}` for the focused editor. Each scenario asserts
  the visible DOM, and then that `json` and `markdownInternal` are **identical across
  the flag-off and flag-on runs** for the same scripted input. That is a browser-level
  differential for free.
- **Determinism for the cross-flag comparison (G6).** Before the scenario's first input,
  the debug hook's `seed({ids, now})` sets, in both builds, the nanoid/nodeIdPlugin id
  generator to a seeded sequence and replaces the history clock (`now`) with a clock the
  test advances. Pauses that must split history merges (E4) advance that clock
  (`__macroEditorDebug.advance(ms)`), never real time. The comparison then applies the
  `corpus/normalize.json` masks (§3.6), and nothing else.
- **Browsers.** Chromium per PR. WebKit (closest stand-in for WKWebView) and Firefox (Macro
  has Firefox-specific code in `plugins/word-navigation`, and Lexical has Firefox paths,
  CMD-13/CMD-16) nightly, all scenarios.
- Waits use Playwright's auto-waiting and `expect.poll` on the debug hook, never sleeps
  (CODING.md). Documents created per test are deleted in `afterEach`.
- Each scenario file starts with one complete literal test (CODING.md), and has a
  `// covers:` line (§0.1).

### 6.2 Scenarios

| # | Scenario | Steps | Asserts |
| --- | --- | --- | --- |
| E1 | Typing | new doc; type 200 chars at end, middle and start of a paragraph; across a bold run; with emoji and combining marks | DOM text, caret position after each burst, JSON, no `console.error` |
| E2 | IME | CDP `Input.imeSetComposition` + `Input.insertText` for Japanese (kana → kanji), Korean (jamo assembly, the iOS Korean path), Chinese pinyin; composition cancelled with Escape; composition across a format boundary. Chromium only; the OS-real orders are E-trace replays (§6.4) | final text, composition never commits partial jamo, undo removes the whole composition |
| E3 | Paste | the §6.5 clipboard matrix: every fixture into every target | JSON equals the flag-off run; pasted ids are fresh (`SELECTION_INSERT_CLIPBOARD_NODES`) |
| E4 | Undo/redo | typing merges (an injected-clock pause > merge interval splits); undo after paste, format and list toggle; redo; Ctrl+Z after reload | the state after each undo equals the recorded intermediate JSON |
| E5 | Tables | insert via slash menu; type in cells; Tab past the last cell adds a row; add or delete row and column from the menu; multi-cell select + Delete (`$clearText` patch: childless paragraphs); merge and unmerge | JSON; markdown table export |
| E6 | Lists | `- `, `1. `, `[] ` shortcuts; Tab and Shift+Tab nesting to 4 levels; Enter on an empty item exits; Backspace at start of item; checkbox click toggles | markdown export uses 2-space indent; checked state persists after reload |
| E7 | Markdown shortcuts | `# `…`###### `, `> `, ```` ```ts ````, `---`, `**b**`, `*i*`, `` `c` ``, `~~s~~`, `[t](u)`; 150 chars of typing after each, to cover the `_cascadeCount` bug | block types; no error #343 on flag on |
| E8 | Mentions and decorators | `@` mention of the other persona, a document mention, a date mention; arrow-key navigation over decorators; delete a decorator | decorator renders at final height on first paint (lexical-nodes rule); JSON |
| E9 | Comments | Alice comments on a range; Bob with comment-only access comments, and his edit attempt is rejected by the gate | the gate verdict on both flag states; comment marks in JSON |
| E10 | Collab: concurrent typing | Alice and Bob in the same paragraph, interleaved bursts; formatting conflicts; one deletes a block the other is typing in | both converge (JSON equal, Loro equal via debug hook); remote cursor visible at the right offset |
| E11 | Collab: mixed models | Alice flag on, Bob flag off, same doc; also with tables, code blocks, comments and mentions in the doc (G8) | convergence: proves wire and storage compatibility during rollout |
| E12 | Offline and reload | Bob `context.setOffline(true)`, edits, reloads while offline (IndexedDB WAL), goes online | his edits survive reload and merge; final JSON equal on both |
| E13 | Large doc | open the 500 KB generated doc (seeded through the API); type 100 chars at the end and in the middle | correctness only: JSON and DOM text after typing equal across flags, no `console.error`. Timing moved to the §5 app cell (G10) |
| E14 | Mobile viewport | iPhone 13 emulation (touch): type, select a word by double-tap, list swipe-indent, table cell touch selection | the same model assertions as E1, E5 and E6 |
| E15 | AI peer (G3) | Alice types in a paragraph while an agent edit lands through ai-editing-worker (`$byId` ops) in the same block and in the adjacent blocks; then while Alice composes IME text | Alice's caret stays at her logical position (the debug hook's selection, as `(block id, offset)`); convergence on both flags; no lost keystroke (her typed string is a substring of the final block text) |
| E16 | AI suggestions (G3) | an agent proposes edits as diff nodes (`DiffInsert`/`DiffDelete`/`DiffText`, `plugins/diff`); Alice accepts one, rejects one, then Ctrl+Z each | JSON after each step equals the flag-off run; undo restores the diff nodes; Backspace at the start of a diff node (S3 Q4, the block-order fix) keeps block order |
| E17 | Collab undo (G3) | Alice and Bob type in one paragraph; Alice presses Ctrl+Z: only Alice's text goes; Bob edits again; Alice presses Ctrl+Shift+Z: her text returns next to Bob's later edit; repeat with Alice flag on and Bob flag off | text after each step as a literal; convergence; Bob's text never removed by Alice's undo |
| E18 | Render equivalence (G7) | open each §3.6b synthetic per-node document and the S/M/L documents with each flag | `rootElement.innerHTML` equal across flags after mapping `data-lexical-key` values through a bijection; screenshot diff ≤ 0.1% pixels |
| E19 | Multi-tab crash (G8) | two pages of one doc in one context; page 1 types a burst, then `Page.crash` (Chromium) / `page.close({runBeforeUnload:false})` (WebKit) mid-burst | page 2 adopts page 1's WAL rows (S7 §3.5); every durable edit reaches the server (the browser twin of S8 `no_persisted_edit_lost`). Also runs S8's SC-1..4 storage-conformance suite against **real** IndexedDB, Web Locks and BroadcastChannel in Chromium and WebKit (audit-r1-D E6) |
| E20 | Server restart (G8) | restart the sync-service container (`docker restart`) while Alice and Bob type | both reconnect, converge; no edit lost |
| E21 | Slow network (G8) | `Network.emulateNetworkConditions` at 300 ms RTT plus a 1% offline flap (toggled every 5 s for 100 ms) during E10's script | convergence; the save state goes back to `saved` |
| E22 | Permission change (G8) | Alice demotes Bob to comment-only while he types | his pending edit is discarded (`EditDiscarded`), his comment still lands, his editor becomes read-only; JSON on Alice's side has no trace of the discarded edit |
| E23 | Legacy content (G8) | open a document with CodeHighlightNodes written by a flag-off client; edit the code block and around it with the flag on; reload on a flag-off peer | the flag-off peer still renders it and its JSON round-trips; D6 migration does not rewrite untouched code blocks |
| E24 | Keys (G9, C5) | Backspace at the start of a heading, a quote, a list item and an indented paragraph; forward Delete merging blocks; Backspace over an inline mention; Ctrl/Alt+Backspace and Cmd+Backspace (divergence 4, `getTargetRanges`); Home and End (in a paragraph and in code, audit-r1-B F2b-4); Shift+Arrow across a decorator and into a table; triple-click (`normalize-triple-click`); select-all inside a table cell, then type; drag-reorder of a block (`draggable-block`) and a text drag-drop move (audit-r1-B C-7); find and replace all, then undo | JSON after each step equals the flag-off run |
| E25 | Channel and chat composer (G1) | `features/channel/Input`: Enter sends, Shift+Enter breaks, the mention picker inserts a user mention, single-line mode, CLEAR_EDITOR after send | the sent message's stored markdown is equal across flags; the composer is empty after send |
| E26 | Email compose (G1) | `features/email-compose`: body with a list, a table, a link, an image, a mention; send to a seeded mailbox | the HTML body through the `/html`-equivalent path equals across flags (lists included, S3 Q1) |
| E27 | Comment threads (G1) | `features/block-md/comments`: reply, edit and resolve, with formatting and a mention in the reply | stored comment markdown equal across flags |
| E28 | Agent composer (G1) | `features/block-agent` and `universal-input`: type a prompt with an `@` agent mention and a document mention, attach, submit | the prompt markdown the harness receives is equal across flags (captured from the request) |
| E29 | Collab surfaces (G1) | a collab surface in canvas (`features/block-canvas` text) and in a form or database description (`lib/core/collab-surface`) | convergence between two personas; stored markdown equal across flags |
| E30 | Remaining surfaces smoke (G1) | one type-format-mention-submit script per surface: task composer, document composer, routines, projects, CRM and entity properties, calendar event description, settings and sharing text fields, notification inbox rendering, block-pr and block-database cells | per surface: stored value equal across flags; no `console.error` |

When routes, editors or composer behaviour change, the `docs/agent-guide/documents.md`
entry is updated in the same change (CLAUDE.md).

### 6.3 Existing editor-touching suites run with the flag on (G5)

SCOPE's M3 exit says "Playwright editor suites green", so the existing suites are
parameterized by the flag (a `rustEditorModel: boolean` Playwright project option that sets
the local override), and **both states must be green**:
- `apps/web/src/lib/core/component/LexicalMarkdown/**/browser-test/*.browser.e2e.ts`
  (lists, list-images, quotes, links, user-mentions, date-chips, preview, task-status,
  routine-mention, poll-card, unavailable-mention, item-bin, composer-menu, large-undo);
- `apps/web/src/lib/core/component/LexicalMarkdown/fuzz/regressions.browser.e2e.ts` and
  `fuzz.browser.e2e.ts` (§3.5);
- `features/block-md/comments/browser-test/{collab,drafts}.browser.e2e.ts`;
- `features/block-write/browser-test/{agent,collaboration,upload}.browser.e2e.ts`;
- `features/universal-input/browser-test/*.browser.e2e.ts`;
- `features/block-canvas/browser-test/text-layout.browser.e2e.ts`;
- `components/app/mobile/browser-test/*.browser.e2e.ts`;
- `components/app/split-layout/browser-test/tiled-splits.browser.e2e.ts`.

The list is regenerated by `just lexical-coverage` (any `*.browser.e2e.ts` that imports from
`LexicalMarkdown` or mounts an editor), and a suite missing the parameter fails the check.

### 6.4 Real input stacks (G2)

CDP's `Input.imeSetComposition` is Chromium-only and its event order is not an OS IME's
(keydown 229, Safari's compositionend-before-keydown, CMD-16). Three mechanisms cover the
real stacks:

1. **Event-trace replay** (`packages/lexical-conformance/e2e-traces/`). Real event
   sequences are recorded once per platform with a recorder page that logs, in order, every
   `keydown`/`keyup` (with `keyCode`, `isComposing`), `beforeinput` (`inputType`, `data`,
   `getTargetRanges()` as offsets), `input`, `compositionstart/update/end`,
   `selectionchange` (offsets), and the DOM mutations of the contenteditable. Each trace is
   one literal JSON fixture: `ios-ja-kana-kanji.json`, `ios-ko-jamo.json`,
   `ios-autocorrect-word.json`, `ios-double-space-period.json`, `ios-smart-quotes.json`,
   `ios-text-replacement.json`, `ios-dictation.json` (`insertReplacementText`, bulk
   `insertText`), `android-gboard-word.json` (every word a composition),
   `android-gboard-suggestion.json`, `macos-pinyin.json`, `windows-ime-ja.json`,
   `chrome-spellcheck-replace.json`, `firefox-ime-ko.json`. Replay dispatches the same
   events synthetically, with the same DOM mutations applied first, in Chromium, WebKit
   and Firefox, against both flags; the final JSON and selection must equal the flag-off
   run on the same engine. Replays run per PR on Chromium, nightly on all three.
2. **iOS simulator, system keyboard** (nightly): XCUITest in the Tauri iOS app on the
   simulator, Japanese and Korean keyboards, autocorrect and predictive text on; types a
   fixed script into a document, then reads the debug hook. Flag on vs flag off.
3. **Android emulator, Gboard** (nightly): UIAutomator in the Android app, Gboard with
   suggestions on, composition typing and suggestion replacement; same assertions.

Recording new traces is manual (a person on a device), once per OS major version; the
fixtures are committed with the device, OS and keyboard version in their header.

### 6.5 Clipboard matrix (G4)

Literal clipboard fixtures (`browser-test/clipboard/*.json`: the `text/html`,
`text/plain`, `application/x-lexical-editor` and file payloads as captured):
- Word (`mso-*` styles, `<o:p>`, conditional comments);
- Google Docs (`b#docs-internal-guid-…`, `font-weight:normal` wrappers);
- Notion, Slack and Apple Notes;
- Google Sheets and Excel ranges → a table node;
- VS Code (`vscode-editor-data` → a code block with language);
- a bare URL → a link; markdown text (markdown-paste plugin); plain text with blank lines;
- an image file plus text;
- Lexical JSON from another Macro document.

Each is pasted into a paragraph, a list item, a heading, a code block, a table cell, and
over a TableSelection. **Cross-model clipboard:** copy with the flag on and paste into a
flag-off page, and the reverse (`application/x-lexical-editor` compatibility during
rollout); the pasted JSON must equal a same-flag copy-paste.

---

## 7. CI wiring

All workflows are written in `tooling/xtask/crates/xtask_workflows` and regenerated
with `cargo x workflows` (`.agents/rules/infra/github-workflows.md`). Two new modules are
registered in `WORKFLOWS`:
- `lexical_conformance.rs` (per PR, called from `pr_ci.rs`, path-filtered);
- `lexical_nightly.rs` (`schedule`).

Paths filter `lexical`:
- `crates/client/lexical/**`
- `packages/lexical-wasm-shim/**`
- `packages/lexical-conformance/**`
- `packages/lexical-core/**`
- `apps/web/src/lib/core/component/LexicalMarkdown/**`
- `apps/web/patches/@lexical*`
- `services/lexical-service/**`
- `docs/design/lexical-port/**` (the generator's inputs, §0.2)

Paths filter `document-session` (R2, audit-r2-4 M7):
- `crates/client/doc_sync_core/**`, `crates/client/document_session*/**`, `crates/sync_protocol/**`
- `packages/collaboration/**`, `tooling/sync-sim/**`
- `apps/web/justfile`, `apps/web/vite.base.ts`, `nix/tauri-desktop.nix`

`target/lexical-upstream/` (the pinned tarball, unpacked) is a CI cache keyed on
`upstream.lock`'s sha256, so `just lexical-fixtures` needs the network only when the pin changes
(audit-r2-4 L5).

| Job | Per PR (filter `lexical`) | Nightly | Release / milestone gate |
| --- | --- | --- | --- |
| `cargo test` for lexical crates: unit, A-hand, gap tests (§1.8a–c), **Tier A replay** (all fixtures, native) | ✓ (`linux-rust-ci`) | ✓ | ✓ |
| Tier A replay on wasm32: `just lexical-replay-wasm` (`cargo test -p lexical_conformance --target wasm32-unknown-unknown --test replay_wasm`, runner `wasm-bindgen-test-runner` in node, §1.6) | ✓ | ✓ | ✓ |
| `just build-lexical-conformance-wasm` (both targets) + the never-shipped assertions of §2.8 (`cargo tree -i`, import scan, bundle symbol scan) | ✓ | ✓ | ✓ |
| `just lexical-coverage-seed --check` (regenerate `seed-matrix.tsv` from `docs/design/lexical-port/`, no diff, no `MISSING` row) and the `pending.txt` ratchet (§0.1) | ✓ | ✓ | ✓; no pending row of the milestone |
| `just lexical-fixtures --check` (re-record, JS self-replay of every fixture §1.3a, transparency check, recorder self-tests §1.8d, no diff) | ✓, when `packages/lexical-core/**`, `services/lexical-service/**`, `packages/lexical-conformance/record/**` or `upstream.lock` changed | ✓ | ✓ |
| `just lexical-coverage --check` (traceability matrix, §0.1 / §8) | ✓ | ✓ | ✓, matrix rendered in the release PR |
| proptest | 256 cases | 20,000 cases | 20,000 |
| Tier B core-only + ported (vitest, 4 shards each) + ledger reconciliation + Rust-vs-fallback counters | ✓ | ✓ | ✓; the §2.7 rule (100% non-ledgered, category floors) and the empty P0 `coverage.json` (§2.2) gate M3 |
| lexical-core suite on the shim (`vitest.shim.mts`, must be 100%) | ✓ (from M3) | ✓ | ✓ |
| Shim hosting tests (`hosting.test.ts`, one per derived hook), `derive-hooks` check, type tests | ✓ | ✓ | ✓ |
| Upstream playground e2e subset on the shim (Chromium, ledgered, §2.5) | ✓ (from M3) | full suite weekly | full suite before enabling the flag for users |
| Tier C lockstep, profiles `upstream`, `macro`, `macro-export` | 10k steps, fixed seeds, 5 min cap; plus `DIFF_TARGET=view` 2k | 1M steps (runs to 5k steps), fresh seeds; plus `DIFF_TARGET=shim` 200k | 1M on the release commit |
| Tier C generator coverage floors (§3.2a) | ✓ | ✓ (incl. long-run floors) | ✓ |
| Tier C collab (M2+) | 2k steps fixed seeds | 200k | 200k |
| Gate fuzzer (§3.6a) | 20k cases, fixed seeds | 1M cases | 1M; any accept-vs-reject difference blocks the release |
| Synthetic per-node generator (§3.6b) | ~2k docs, fixed seed | fresh seeds | every node × route has a passing case (M1) |
| Regex and linkify-it differentials (§3.6c) | fixed corpus | + fast-check strings | ✓ |
| Corpus replay (dev) | — | ✓, in a job with dev read credentials; output ids, paths, hashes, node histogram and mask counts only | ✓, 100% identical after masks required for each M1 route flip |
| Perf: instruction counts, work counters, boundary counters (§5.2 item 8) | ✓, any runner | ✓ | ✓ |
| Perf: wall time (input → frame, bulk, memory, open), both cells | smoke: 5 pairs, medium doc, reported, not gated | full design on the bare-metal runner, gated; trend uploaded | full, gated (M3 exit) |
| wasm size + init, sync-service Worker size | ✓ (gated against the provisional budget) | ✓ | ✓ |
| `document-session` filter: `just build-document-session-wasm`, the §5.4 size gate on that exact artifact, the desktop check (`nix/tauri-desktop.nix` `coreWasmPackages` lists the package), and `cargo tree -p <crate> --target wasm32-unknown-unknown -e normal -i workspace-hack` empty for every `crates/client/*` crate (audit-r2-4 B3, M3) | ✓ (filter `document-session`) | ✓ | ✓ |
| Browser e2e E1–E30, both flag states | E1, E3, E5, E7, E10, E15, E17, E18, E24, E25 on Chromium against a local stack (from M3), plus event-trace replays on Chromium | all, Chromium + WebKit + Firefox, plus all event-trace replays | all |
| Existing editor-touching Playwright suites (§6.3), both flag states | the suites whose paths changed | all | all |
| #8309 collab fuzzer on the swapped editor | — | `FUZZ_RUNS=3 FUZZ_STEPS=150`, flag on and off | 10 runs |
| iOS simulator bench + XCUITest keyboard runs; Android emulator bench + Gboard runs | — | ✓ (trend only) | — |
| iOS / Android device bench | — | — | checklist §5.5/§5.6 (M3 exit, and each Lexical bump after M3) |
| Shadow-mode report | — | daily summary from Datadog | M1: 7 days at zero mismatches per route group |

Per-PR jobs are required checks through the CI gate only when the `lexical` filter
matches. Nightly failures post to the run summary and open nothing automatically.

**Lexical version bump.** A bump follows SCOPE's "pin to v0.45.0 through M3", then
monthly:
1. bump `upstream.lock`;
2. `just lexical-fixtures`, and review the fixture diff;
3. run Tier B in both configs, and review the ledger diff;
4. run Tier C nightly on the branch;
5. re-port the view files (`packages/lexical-wasm-view` `view/`, S12 §1) from upstream's diff;
6. re-run `derive-hooks`, `lexical-coverage-seed` and `lexical-coverage`, and review the
   diffs (a new upstream export or S2 id appears as a new matrix row with a pending test).

The bump PR carries all of those diffs.


---

## 8. Traceability matrix (A1)

This is the hand-written, per-family summary of the matrix. The per-id matrix is generated
(§0.2) and is authoritative: `S4-matrix.tsv` at spec time, `coverage/seed-matrix.tsv` in the
repo. The generator reads §8.2's C and e2e columns into each id's `also` column, and §8.3, §8.4
and §8.6 as the named tests of their rows. Every row below names the test tier and the test id
(or id pattern) that covers it. "A" = A-rec fixtures
(the recorder index lists which), "A-h" = A-hand / gap tests, "B" = Tier B, "C" = Tier C
command, "S8" = S8 invariant or story, "e2e" = §6 scenario.

### 8.1 S2 exported symbols, P0 and P1

| S2 package | P0 / P1 | Tier and test ids |
| --- | ---: | --- |
| `lexical` | 151 / 86 | A (LexicalNode, Selection, Caret, Editor, TextNode, … fixtures), B (all core files), C (§3.2); the 25 core P0 values no upstream test names: §1.8a `hand::lexical_gaps::*`, `hand::commands_gaps::*`, Tier C key commands |
| `@lexical/clipboard` | 5 / 9 | B (`GetClipboardDataExtension`, `ClipboardImportExtension`), C `Copy`/`PasteNodes`, §1.8a `hand::clipboard_gaps::*`, e2e E3 |
| `@lexical/code` (+ code-core, code-prism re-exports) | 9 / 3 | A (`LexicalCodeNodeTabs` ×84, `LexicalCodeNode`), C `SetBlocksType(code)`, `KeyTab`, `CodeMoveLines`, `CodeSetLanguage`, `hand::code_gaps::*` |
| `@lexical/headless` | 1 / 1 | A (`LexicalHeadlessEditor`), every Tier C run (U is headless) |
| `@lexical/history` | 2 / 3 | A (`LexicalHistory`), C `Undo`/`Redo`/`Tick`/`ClearHistory`/`NestedEditor`, e2e E4, E17 |
| `@lexical/html` | 2 / 34 | B (63 B-only + 18 view), corpus `/html` route, §3.6b HTML column, e2e E26 |
| `@lexical/link` | 7 / 8 | A (74), C `ToggleLink`/`AutoLinkText`, e2e E3 (bare URL) |
| `@lexical/list` | 14 / 7 | A (47), C list commands + `KeyEnter`/`KeyBackspace`/`KeyTab` in items, §1.8a list command rows, e2e E6 |
| `@lexical/mark` | 7 / 0 | A (6), C `WrapComment`/`UnwrapComment`, `hand::mark_gaps::*`, gate fuzzer §3.6a, e2e E9 |
| `@lexical/markdown` | 15 / 2 | A (385 + lexical-core), C `PasteMarkdown`/`MarkdownShortcut`, `hand::markdown_gaps::*`, §3.6c regex differential, e2e E7 |
| `@lexical/plain-text` | 1 / 1 | `hand::plain_text::*` (PT-01..16), B `PlainRichTextPlugin`, e2e E25 single-line mode |
| `@lexical/rich-text` | 9 / 3 | A (11), B (44 B-only), C key commands, NodeSelection commands, e2e E24 |
| `@lexical/selection` | 5 / 4 | A (86), C `PatchStyle`, `hand::selection_gaps::*` |
| `@lexical/table` | 33 / 8 | A (27), B (13 + 55), C 8 table commands + `TableSelection*` + table-edge arrows, `hand::table_gaps::*`, web plugin fixtures (§1.9), e2e E5 |
| `@lexical/utils` | 12 / 21 | A (26), `hand::utils_gaps::*` |
| `@lexical/react` | 1 / 55 | B (view); the one P0 (`LexicalComposer` types) via types test |
| `@lexical/extension`, `hashtag`, `overflow`, `text`, `offset`, `code-shiki`, `devtools-core`, `yjs`, `internal`, `tailwind` | 0 / 73 | B for every P1; A where recorded (hashtag 1, overflow via `useLexicalCharacterLimit`); `hand::offset::*`, `hand::text::*` (§1.9 note); `yjs` P1s via the B collab files only (reference package) |
| All 13 P0 types | — | `types.test-d.ts` (§1.8a) |

### 8.2 S2 behaviour families (§3A–§3D)

| Family (items) | Class | A | A-h | B | C | e2e / other |
| --- | --- | :-: | :-: | :-: | :-: | --- |
| CMD (50) | MODEL+BRIDGE | ✓ | `commands_gaps` | ✓ | key and bus commands (§3.2 D2) | E24 |
| EVT (36) | BRIDGE/VIEW | – | – | ✓ | `Batch`, `TextFromView`, `SelectionFromView` | E1, E2, E24, §6.4 traces |
| RT (45) | BRIDGE | – | – | ✓ (44 B-only) | `KeyEnter`/`KeyBackspace`/`KeyDelete`/arrows/NodeSelection* in ported config and on R | E24 |
| PT (16) | BRIDGE | – | `plain_text::*` | ✓ | – | E25 |
| DRG (5) | VIEW | – | – | ✓ | – | ledger `view-only` |
| NRM (10), EL (21), TX (15), FMT (5), NODE (20), ID (12), TF (8) | MODEL | ✓ | P3 hand | ✓ | all text/structure commands | proptest P1–P5, P12 |
| UPD (17), TAG (13) | MODEL | ✓ | `commit.rs` (~20) | ✓ | `UpdateWithTag`, commit-content compare (D5) | – |
| LST (9) listeners | BRIDGE | – | `commit.rs` | ✓ (B-only) | commit-content compare | – |
| JSON (9) | MODEL | ✓ | – | ✓ | `SetEditorState`, `ParseForeign` | §3.6b, corpus, proptest P6 |
| NS (19), CFG (11) | MODEL | 5 | 13 + `ambiguous_*` | ✓ | `SetNodeState` | gate fuzzer (NodeState mutations) |
| CARET (39) | MODEL | 53 | – | ✓ | – | – |
| SEL (82) | MODEL | 42 | `selection_gaps` | ✓ | `Select`, `SelectionFromView`, `DeleteWord/Line` (SEL-50) | E24 (divergence 4 via real chords), §2.5 playground subset |
| MD-T, MD-RX, MD-ST, MD-PUNCT, MD-EMPTY, MD-ESC, MD-LEGACY, MD-HEADING, MD-BLOCK, MD-QUOTE, MD-LIST, MD-CODE, MD-FMT, MD-LINK, MD-ARR, MD-IMP, MD-EXP (~130) | MODEL | 385 | `markdown_gaps`, `ambiguous_md_*` | ✓ | `PasteMarkdown` | §3.6c regex differential, corpus `/markdown` |
| MD-SC (19) | MODEL | ✓ | – | ✓ | `MarkdownShortcut`, uncapped runs (D4) | E7 |
| LNK-N, LNK-TR, LNK-A, LNK-TG, LNK-R, LNK-AL (~52) | MODEL | 74 | `ambiguous_lnk_*` | ✓ | `ToggleLink`, `AutoLinkText`, typing at a link boundary (generator region "inside a link") | §3.6c linkify-it differential |
| LNK-CL (4) | VIEW | – | – | ✓ | – | ledger `view-only` |
| HT (8), TXT (10), OVF (11), OFF (10) | MODEL | small | `hand::text`, `hand::offset` | ✓ | – | Q14: P2 for Macro |
| MRK (13) | MODEL | 6 | `mark_gaps` | ✓ | `WrapComment`/`UnwrapComment`, overlapping marks and typing at a mark boundary (region "inside a mark") | gate fuzzer, E9 |
| TW (1), FILE (5) | VIEW / P2 | – | – | ✓ | – | ledger |
| RX-* (40, React plugins with model behaviour) | BRIDGE | 2 | the model halves Macro uses: `RX-CLEAR` → `clear_editor_*`, `RX-TABLE`/`RX-LIST`/`RX-CHECK` → table/list hand files, `RX-MDSC` → markdown shortcuts | ✓ | `ClearEditor`, list and table commands | web plugin fixtures (§1.9) |
| PATCH-TBL, PATCH-MD (2) | MODEL | macro profile | `tableClear` fixture | – | `ClearCells`, list indent 2 | E5, E6 |
| TBL-CELL, TBL-ROW, TBL-TBL, TBL-MAP, TBL-OP, TBL-NORM (~55) | MODEL | 27 | `table_gaps` (A3) | ✓ | 8 table commands | E5 |
| TBL-SEL (11) | MODEL | ✓ | – | ✓ | `TableSelectionFormat/InsertText/Delete` | E5, E24 |
| TBL-KEY (18) | BRIDGE | – | – | ✓ | `KeyTab`/`KeyArrow` in tables | E5, E24 |
| TBL-PLG (7), TBL-EXT (3) | MODEL | 6 | – | ✓ | – | – |
| TBL-OBS (9), TBL-PTR (7) | BRIDGE | – | `observer_selection_follows_cell_range` | ✓ (view) | – | E5, E14 (touch) |
| LST-NODE, LST-ITEM, LST-NUM, LST-INS, LST-IND, LST-CHK, LST-EXT (~58) | MODEL | 47 | list hand tests | ✓ | list commands | E6 |
| LST-KEY (5) | BRIDGE | – | – | ✓ | `KeyEnter`/`KeyBackspace` in items | E6 |
| CODE-NODE (14) | MODEL | ✓ | `code_gaps` | ✓ | `SetBlocksType(code)` | E23 |
| CODE-KEY (11) | BRIDGE | 84 | `home_end_in_paragraph_is_not_handled` | ✓ | `KeyTab`, `CodeMoveLines`, `CodeSetLanguage`, arrows into code | E24 |
| CODE-HL, CODE-PR, CODE-SH (28) | VIEW under D6 | – | – | ✓ (`d6-highlight` ledger where they assert highlight nodes) | – | E23, iOS 15/16 fallback (§5.5) |
| HIS (49) | MODEL | 14 + 2 | – | ✓ | `Undo`/`Redo`/`Tick`/`ClearHistory`/tags/`NestedEditor` (HIS-42, 80–83), `Composition` (HIS-31/33 via `TextFromView` with composition tags) | E4, E17, §3.5 item 3 |
| CLP (47) | BRIDGE | – | `clipboard_gaps` | 16 | `Copy` (export half compared), `PasteNodes`, `DropMove` | E3, §6.5 cross-model clipboard |
| HTML (47), HREN (19), HIMP (42) | BRIDGE (import JS, D4) | – | `html::*` (§1.8b) | 81 | – | corpus `/html`, §3.6b HTML column, E3, E26 |
| EXT (34), XB (26) | MODEL (not imported by Macro) | 2 | `clear_editor_*` (XB-04) | ✓ | `ClearEditor` | ledger `not-ported` for the rest, per S3 R1 C-6 |
| HDL (3) | MODEL | 4 | – | ✓ | every run | – |
| YJS (16) | reference only | – | – | ✓ (B collab files) | – | ledger `not-ported` (Loro replaces it) |
| UTL (35) | MODEL | 26 | `utils_gaps` | ✓ | – | – |
| AMBIGUOUS flags (74 + S2 §5) | — | – | `ambiguous_<id>` each (§1.8c) | – | – | – |

### 8.3 S3 nodes

Every node also has: the §3.6b synthetic cases on every route (`synthetic::<node>::<route>`),
JSON-exactness tests for absent/null fields where P3-4/P3-6 apply, the gate fuzzer's
per-field mutation, and e2e E18 render equivalence. The table lists what is specific.

| S3 node | lexical-core tests that name it (A-rec) | Specific R1 tests |
| --- | --- | --- |
| `AccountManagerRequestNode` | `account-manager-request` | – |
| `AgentActivityNode` | (via `agent-chat-reply`, `agent-activity-markdown`) | `nodes::agent_activity_row_card_null_round_trips`, Q21 ordered rows |
| `AgentContextNode` | `agent-context`, `agent-trigger-context` | composer goldens (S3 §4.4) |
| `AgentSessionMentionNode` | `agent-session-mention`, `session-decorator-stability` | gate: its static transform runs (F2b-9) |
| `AwaitNode` | (via `mentions`) | `awaitId` mask counted |
| `BookingLinkMentionNode` | none | `nodes::booking_link_url_uses_passed_host`, `…_headless_when_host_none`; synthetic only |
| `ClassedBlockNode` | `classedBlock`, `htmlRender` | – |
| `CommentNode` | `comment-mark-identity`, `comment-mark-text` | gate suite (§3.6a), E9, E22, E27 |
| `CompletionNode` | none | synthetic only; `ImportedState::None` round trip |
| `ConnectAppNode` | `connect-app` | – |
| `ContactMentionNode` | (via `mentions`) | P3-4 absent `isCompany`/`emailOrDomain` |
| `CursorSystemNotificationNode` | `cursor-system-notification` | – |
| `CustomCodeNode` | `xml-serialize` | `custom_code_language_normalized_on_first_writable_clone`, gate `code`→`custom-code`, E23 |
| `DatabaseQueryNode` | `database-query` | – |
| `DateMentionNode` | `date-mention-import`, `tables` | E8 |
| `DecoratorBlockNode` (abstract) | none | via `DocumentCardNode` and synthetic subclasses |
| `DiffNode`, `DiffInsertNode`, `DiffDeleteNode`, `DiffTextNode` | none | synthetic only; Q4 block-order fix test; E16 |
| `DocumentCardNode` | `document-card-conversion`, `document-reference-decorator-stability` | – |
| `DocumentMentionNode` | `document-card-conversion`, `xml-serialize` | `document_mention_created_at_from_injected_clock` |
| `EquationNode` | `katex`, `xml-serialize` | `equation_btoa_*` |
| `GroupMentionNode` | (via `mentions`) | P3-4 absent `groupAlias` |
| `HorizontalRuleNode` | (via markdown fixtures) | synthetic; E7 `---` |
| `HtmlRenderNode` | `htmlRender`, `xml-serialize` | `html_render_*` (R-3) |
| `ImageNode`, `VideoNode` (`MediaNode` base) | `generated-image`, `list-images`, `tables` | P3-4 Media optional fields; E3 image paste |
| `InlineSearchNode` | none | synthetic only; E24 find and replace |
| `MagicChipNode` | `magic-chip`, `session-decorator-stability` | `magic_chip_channel_id_null_round_trips_null` |
| `PasteNode` | `paste` | – |
| `PullRequestMentionNode` | `pr-mention` | – |
| `ReplyTargetNode` | `reply-target-node`, `explicit-reply`, `agent-announcement` | – |
| `SearchMatchNode` | none | synthetic only; `IMPORT_ELEMENT_DATA = false` round trip; E24 find |
| `SnapshotNode` | (via `notion-markdown`) | `snapshot_missing_date_*` |
| `TagMentionNode` | (via `mentions`) | P3-4 absent `scope`/`name` |
| `TaskListNode` | `list-transformers` | gate `list`→`task-list`; legacy `list` corpus case |
| `ThemeMentionNode` | one file | synthetic |
| `UnknownMentionNode` | `database-query`, `internal-transformer-fallbacks` | – |
| `UnlinkedTextNode` | `auto-link` | – |
| `UserMentionNode` | `mentions`, `xml-serialize` | P3-4 absent `email`; E8, E25 |
| `WatermarkNode` | none | `nodes::watermark_remove_is_noop` (S3 CR-1); synthetic |
| upstream `heading`, `quote`, `list`, `listitem`, `link`, `autolink`, `table`, `tablerow`, `tablecell`, `code`, `code-highlight` (legacy), `mark`, `hashtag`, `overflow`, `tab`, `linebreak`, `paragraph`, `root`, `text` | upstream A-rec per package (§1.9) | `hosting.test.ts` per derived hook; `code-highlight` via E23 and `codeHighlight` normalization |

### 8.4 S3 routes (route map numbering)

| # | Route | Tests |
| --- | --- | --- |
| 1 | `/plaintext` | corpus once (dropped by Q12; ledger `dropped-route` after) |
| 2, 3 | `/cognition/presigned`, `/cognition` v1 | as 1 |
| 4 | `/cognitionv2` | corpus (export registry), §3.6b, shadow |
| 5 | `/search` | corpus (export registry, legacy `list`/`code` case), §3.6b, Tier C macro extras, shadow |
| 6 | `/markdown?target=` | A-rec lexical-core markdown fixtures, corpus ×3 targets, §3.6b, Tier C macro extras, shadow |
| 7 | `/comment-mark` | A-rec `comment-mark.test.ts`, corpus (every mark id), shadow |
| 8 | `/comment-only-change` | A-rec `comment-only-change.test.ts` (12), §1.8b gate tests, §3.6 edits (a)–(j), §3.6a fuzzer, `registry_equals_lexical_service_create_editor`, in-process vs HTTP shadow in sync-service, E9, E22 |
| 9 | `/xml` | A-rec `xml`, `xml-serialize`; route dropped (Q12), codec kept |
| 10 | `/snapshot/markdown` | A-rec `golden` (`MARKDOWN_GOLDEN` bytes), corpus (`doc.toJSON()`), §3.6b Loro column, shadow |
| 11 | `/snapshot/notion` | A-rec `notion-markdown`, `notion-snapshot.test.ts`, corpus |
| 12 | `/html` | A-rec `html.test.ts`, `html-text-formats`, `htmlRender`; `html::list_markdown_renders` (Q1), §3.6b HTML column, E26, shadow |
| 13 | `/mentions` | A-rec `mentions`, `channel-mentions`, corpus |
| 14 | `/extract-reply` | A-rec `explicit-reply`, `extract-reply.test.ts` |
| 15 | `/agent-announcement` | A-rec `agent-announcement` (lexical-core + endpoint), `agent-chat-reply`, `agent-connection-prompt` |
| 16 | `/agent-context` | A-rec `agent-context` (both), `agent-trigger-context`, legacy-body rule (F2b-23/A-12) |
| 17 | `/image-markdown` | A-rec `generated-image`, `image-markdown.test.ts`, P3-14/P3-15 tests |

### 8.5 S3 transformers

Per const, not per file (R2, G-6). The generator emits one `tf` row per S3 §4.2.6 row (89 Macro
rows) and per upstream transformer object of S3 §2.11, and one `tf-order` row per transformer
list. A `tf` row is satisfied by an A-rec fixture in whose replay the transformer **fired**
(the recorder's firing trace, §1.3 item 6; the old "const appears in a fixture's API list" rule
is gone, because transformers are values in arrays, not calls) or by its fallback literal test
`transformers::<const>_fires` (`crates/client/lexical/{macro_document_model,lexical_markdown}/tests/transformers.rs`).
Helper-function rows of §4.2.6 (`utils/parsers.ts`, `utils/html-entities.ts`,
`utils/quote-markdown.ts`, `utils/markdown-mentions.ts`, `unknownFallback.ts`, the auto-link
helpers, linkify-it) get `md_utils::<fn>` literal tests. Every const with a regex is also in the
§3.6c differential.

**Order is the behaviour (MD-ARR).** Import tries transformers in array order and the first match
wins, so each list gets a literal test that asserts the Rust list's names, in order, equal the
TS list recorded from lexical-core (or upstream) as a literal:
`transformers::internal_transformers_order_equals_ts` (63 entries, `index.ts:73`),
`transformers::external_transformers_order_equals_ts` (66, `index.ts:123`),
`transformers::all_transformers_order_equals_ts` (89, `index.ts:170`),
`transformers::custom_transformers_order_equals_ts` (20, `customTransformers.ts:57`), and, in
`lexical_markdown`, `transformers::{element,multiline_element,text_format,text_match}_transformers_order_equals_ts`
and `transformers::transformers_order_equals_ts`.

A-rec fixtures by source file (the evidence the firing trace will attribute per const):

| Source (`packages/lexical-core/transformers/` unless noted) | A-rec fixtures |
| --- | --- |
| `transformers.ts` (PRESERVE_LINES, BR_TAG_*, lists, quotes, checklists, …) | `preserve-lines`, `list-transformers`, `list-images`, `html-text-formats`, `notion-markdown`, `slack-import-links`, `internal-transformer-fallbacks` |
| `customTransformers.ts` (`MACRO_ORDERED_LIST`, `customTransformer(CHECK_LIST/UNORDERED_LIST)`, `CUSTOM_TRANSFORMERS`) | `list-transformers`, `list-images`, every lexical-core markdown fixture (the lists are in all three arrays) |
| `index.ts` (`INTERNAL_TRANSFORMERS`, `EXTERNAL_TRANSFORMERS`, `ALL_TRANSFORMERS`) | the order tests above; every lexical-core markdown fixture |
| `unknownFallback.ts` | `internal-transformer-fallbacks`, `database-query` |
| `mentions.ts`, `unknownMention.ts` | `mentions`, `channel-mentions`, `date-mention-import`, `document-mention-without-name`, `routine-mention`, `pr-mention`, `agent-session-mention`, `external-chat-references`, `form-references` |
| `auto-link.ts`, `utils/auto-link.ts`, linkify-it 5.0.2 | `auto-link` (+ the linkify-it differential, §3.6c) |
| `databaseQuery.ts` | `database-query` |
| `snapshot.ts`, `paste.ts`, `htmlRender.ts`, `await.ts` | `paste`, `htmlRender`, `notion-markdown` |
| `magicChip.ts`, `agentActivity.ts`, `reply-target.ts`, `agentContext.ts`, `watermark.ts` | `magic-chip`, `agent-activity-markdown`, `reply-target-node`, `agent-context`, `agent-chat-reply` |
| `video.ts`, `image.ts` | `generated-image`, `list-images`, `mediaWrapperImport` (B) |
| `katex.ts` | `katex` |
| `tables.ts` | `tables` |
| `classedBlock.ts` | `classedBlock` |
| `cursorSystemNotification.ts` | `cursor-system-notification` |
| `htmlTextFormats.ts` | `html-text-formats` |
| `utils/html-entities.ts` (`decode_html_entities`, `HTML_ENTITIES`) | `html-text-formats`; `md_utils::decode_html_entities` |
| `utils/parsers.ts` (17 fns) | none in lexical-core (lexical-service routes call them: `/search`, `/cognitionv2`, `/agent-context`); one `md_utils::<fn>` each, expected values from running the TS fn |
| `utils/quote-markdown.ts` (`quoteMarkdown`) | `explicit-reply`; `md_utils::quote_markdown` |
| `utils/markdown-mentions.ts` (`extractChannelMentionsFromMarkdown`) | `channel-mentions`; `md_utils::extract_channel_mentions_from_markdown` |
| upstream HEADING, QUOTE, CODE, 9 text formats, LINK, the list transformers | upstream `LexicalMarkdown.test.ts` (385) + every lexical-core markdown fixture |
| `ORDERED_LIST_ENTER`, `BR_TAG_TO_SPACE` (in no list) | `hand::markdown_gaps::ordered_list_enter_*`, `br_tag_to_space_*` (literal tests; no list reaches them) |

### 8.6 S7 §6 behaviours

S8 owns most of these; the test names below are the required tests (S8 R1 may rename them;
the `covers: S7:<n>` tag is what the matrix reads). `dsc` = `doc_sync_core::tests`,
`ds` = `document_session::tests`, `exec` = the TS executor's tests
(the vitest project of `packages/collaboration`, which owns the executor per S7 §4.3).

| S7 # | Test |
| --- | --- |
| 1 | `dsc::lifecycle::start_twice_is_noop`, `…::start_before_seeded_stays_loading` |
| 2 | `dsc::wal::one_row_per_25ms_window`; S8 `no_edit_lost_without_crash` |
| 3 | `dsc::access::read_session_never_writes`; S8 `refused_updates_never_applied` |
| 4 | `dsc::chatter::update_and_awareness_imported`; S8 `all_docs_equal` (multi-tab profile) |
| 5, 57 | `dsc::connection::registers_peers_on_synced`; S8 client golden transcript `register_before_push`, `reconnect_reregisters` |
| 6 | `dsc::snapshot::prune_exactly_covered_rows`; S8 `no_persisted_edit_lost` |
| 7 | S8 story `converge_from_server_on_start` |
| 8 | `dsc::lifecycle::stop_clears_presence_and_pushes`; S8 `presence_expires` |
| 9 | S8 story `projection_error_resets` (`ClientBuild::Faulty`) |
| 10, 91, 92 | S8 `presence_converged`; `lexical_loro` cursor codec round trip |
| 11 | S8 story `reset_replaces_and_reinitializes` (`Net(CorruptNext)`) |
| 12 | S8 story `reset_failure_restarts_on_old_doc` |
| 13 | S8 story `persistent_bad_update_closes_corrupt` (`reset_budget`) |
| 14, 23, 94, 100, 102 | removed (ledger `removed`) |
| 15 | `dsc::imports::packet_after_stop_dropped`; S8 `per_step` |
| 16 | S8 story `import_pending_triggers_converge` |
| 17 | `dsc::imports::incremental_snapshot_imported_as_update` |
| 18 | S8 story `reconnect_reconverges` |
| 19 | `dsc::converge::rerun_coalesces` |
| 20 | `dsc::converge::three_attempts_two_second_delay` |
| 21 | `dsc::converge::empty_catch_up_is_noop` |
| 22 | `dsc::converge::pending_after_reply_bounded_by_max_attempts` |
| 24, 31 | `dsc::wal::delivered_through_prefix`, `…::ack_marks_through`; S8 SC-1 |
| 25 | `dsc::wal::expired_rows_dropped_with_telemetry` (asserts the span and its fields) |
| 26 | `dsc::wal::append_before_push`; S8 `server_acks_after_durable` |
| 27 | `exec::idb_append_retries_once_on_abort` (fake-indexeddb abort injection); real IDB in E19 |
| 28 | `dsc::wal::late_rows_rerun_flush` |
| 29 | `dsc::wal::push_all_undelivered_in_one_batch` |
| 30, 33 | `dsc::wal::not_acked_emits_delivery_outage`, `…::outage_reported_once_per_stage` (span asserted) |
| 32, 96 | S8 `Step::Flush` story `flush_waits_for_appends`; `ds::flush::resolves_when_dirty_zero` |
| 34 | `dsc::storage::setup_retried_on_demand` |
| 35 | S8 story `reconnect_flushes_wal` |
| 36 | S8 story `crashed_tab_rows_adopted` + `no_persisted_edit_lost`; e2e E19 |
| 37, 105 | `ds::generic_surface::unlogged_rows_save_state`, `…::save_state_transitions` |
| 38, 107 | S8 SC-2 (fake IDB) and E19 (real IDB); `ds::generic_surface::snapshot_serialized_across_mounts` |
| 39 | S8 story `corrupt_cached_snapshot_deleted` (`Storage(CorruptSnapshot)`) |
| 40 | S8 story `wal_row_replay_error_skipped` |
| 41, 109 | S8 story `seed_first_wins`, `seed_cached_s3_races_dss` (`SeedDocument::Cached{s3, local}`) |
| 42 | S8 story `wal_replayed_on_dss_seed` |
| 43 | `dsc::snapshot::resave_after_replay` |
| 44 | `dsc::commit::record_timestamp` |
| 45 | `dsc::peer::random_peer_per_doc` |
| 46 | `lexical_loro` `sync_doc::export_local_only_own_spans` |
| 47 | `dsc::imports::replace_requires_self_contained` |
| 48 | S8 `undo_reverts_only_own`; §3.5 item 3; e2e E17 |
| 49 | `dsc::connection::timeouts_match_today` |
| 50 | `dsc::connection::heartbeat_only_when_synced` |
| 51 | S8 story `late_initial_sync_accepted` |
| 52 | `dsc::wal::no_push_before_synced` |
| 53 | `dsc::wal::single_push_in_flight`; S8 `per_step` |
| 54 | S8 story `close_cancels_in_flight_push` |
| 55, 103 | S8 story `comment_only_publish`; e2e E9, E22 |
| 56 | `dsc::presence::not_sent_when_closed` |
| 58 | `dsc::converge::request_snapshot_timeout` |
| 59 | `dsc::converge::vv_byte_equal_match`; S8 client transcript `request_since_vv_encoding` |
| 60 | `dsc::connection::online_visible_transitions` |
| 61 | `dsc::imports::pre_listener_frames_dropped_then_refetched` |
| 62 | `dsc::connection::close_leaves_synced` |
| 63 | `exec::host_signals_map_to_inputs` |
| 64 | `dsc::connection::stale_token_result_ignored` |
| 65 | `dsc::connection::backoff_250ms_x5_20_retries` |
| 66, 81 | `dsc::connection::gave_up_revived_by_online_visibility_edit`, `…::local_change_revives_gave_up` |
| 67 | `dsc::connection::reconnect_event_only_after_first_sync` |
| 68 | S8 story `reconnect_rederives_intents` |
| 69, 70 | `dsc::connection::missed_pongs_close_1000`, `…::pong_resets_missed` |
| 71 | `exec::heartbeat_on_closing_socket_runs_close_handling` |
| 72 | `dsc::connection::reconnect_while_connecting_noop` |
| 73 | `exec::abandoned_connecting_socket_closed_on_open` |
| 74 | `dsc::connection::token_failure_backs_off` |
| 75 | `dsc::connection::connect_timeout_fires` |
| 76, 89 | `sync_protocol::frames::split_and_reassemble_900000`; S8 multi-frame floor (≥ 5% of runs, large seed) |
| 77 | `exec::tauri_ws_read_error_closes_1006` |
| 78 | `dsc::connection::token_fallback_rules` |
| 79 | `dsc::connection::socket_connect_carries_traceparent` |
| 80 | `dsc::access::revoked_closes_unauthorized`; S8 `refused_updates_never_applied`; e2e E22 |
| 82 | `dsc::access::comment_only_never_pushes_content` |
| 83–88 | `dsc::router::{shared_socket_subscribe_per_doc, frames_held_until_subscribed, resubscribe_backoff_500_to_8000, new_owner_resubscribes, close_codes_4401_4000, reconnect_resubscribes_all}`; S8 router profile |
| 90 | S8 `presence_expires` |
| 93 | `dsc::presence::color_from_config` |
| 95 | `exec::chatter_shape_compatible_with_legacy` |
| 97 | S8 `per_step` (S-3); `ds::init::no_loro_write_before_first_sync` |
| 98 | `ds::init::strips_draft_marks_and_force_syncs` |
| 99 | S8 `Step::EditorError` story `editor_error_stops_session` |
| 101 | `ds::remote::selection_restored_from_awareness`; e2e E10 |
| 104 | `dsc::presence::refresh_every_3s_while_connected` |
| 106 | `forms-publish.test.ts::publishes 750 ms after delivered edits` (the forms feature's own vitest file, app level on `Status`, S7 §6) |
| 108 | `dsc::config::transport_none_memory_persistence` |
| 109 | S8 story `cached_seed_race` (`SeedDocument::Cached{s3, local}`) |
| 110 | `dsc::connection::initial_sync_awareness_imported_presence_only` (every `RemoteInitialSync` imports its awareness bytes into presence, never into the doc); S8 client transcript allowlist cites row 110 |
| 111 | `dsc::converge::retry_rereads_oplog_vv`, `dsc::converge::empty_reply_not_retried` |
| 112 | `dsc::telemetry::catchup_parents_on_connect` (asserts the `doc.sync.catchup` record's parent is the `doc.sync.connect` record on a reconnect, and the load span on first open) |
| 113, 114 | S8 story `ai_worker_peer_hidden_and_flushes` |
| 115 | `exec::tauri_seq_dedupe_and_recover_before_visible` (duplicate `seq` dropped; `recover({after})` issued before `host(Visible)`; a replay gap fails the connection; close while CONNECTING) |
| 116 | `ds::init::empty_cached_snapshot_is_none` |
| 117 | `dsc::connection::close_codes_1008_4401_4000` (1008 and a repeated 4401 after a fresh-token retry → `Closed(Unauthorized)`; 4000 and others → `Backoff`) |
| 118 | `sync_protocol::frames::final_flag_nonzero_and_empty_frame_error` |
| 119 | `ds::lifecycle::reset_before_running_waits`, `ds::lifecycle::edit_before_seeded_not_ready` |
| 120 | `ds::undo::max_steps_100`, `ds::undo::empty_doc_undo_is_err` |
| 121 | S8 story `frozen_tab_rows_assisted` |
| 122 | S8 stories `chatter_dependency_survives_writer_crash`, `poison_row_quarantined` |
| 123 | `dsc::snapshot::root_at_last_converged_base`, `dsc::snapshot::save_skipped_while_own_entry_unlogged`, `dsc::snapshot::save_deferred_while_typing` |

---

## R1 resolutions

Every finding of `audit-r1-D.md` (57) and every test gap of `audit-r1-B.md`, in the audit's
§H priority order first. "Accepted" means the fix is in this spec as written; "modified"
means accepted with a stated change; "delegated" means another spec owns the fix and S4
references it. Nothing is rejected outright.

### audit-r1-D, §H priority order

| # | Finding | Sev | Resolution | Where |
| --- | --- | --- | --- | --- |
| 1 | B1 depth counter records plugin/internal calls | Critical | Accepted: call-site attribution (2a), depth as second guard (2b), async entry points wrapped (2c), and the JS self-replay of every fixture on upstream before it is written (§1.3a); cascade updates are tagged `listener-enqueued` and not replayed (§1.6) | §1.3 items 2a–2c, §1.3a, §1.6 item 1, §1.8d test 1 |
| 2 | D1 production typing path untested | Critical | Accepted: `TextFromView`, `SelectionFromView`, `Batch` commands; U runs them through a jsdom root; weight 20% + 5% + 5% (≥ `InsertText`) | §3.1, §3.2 "Production input path" |
| 3 | F1 harness doesn't measure typing | Critical | Accepted: `Input.dispatchKeyEvent` keyDown/keyUp at 80 ms cadence and 8-per-frame bursts; metric = `EventLatency` input → presented frame; handler, layout, dropped frames; in-page timing demoted to diagnostic | §5.1 |
| 3 | F2 statistics can't resolve 3%/5% | Critical | Accepted: fresh-context rounds on distinct origins, randomized pairs, bare-metal isolation, ≥ 50 A/A calibration pairs, `n = ⌈(2.80·σ_d/δ)²⌉` with a 30-pair minimum, CI-based equivalence rule with a Pocock second look, stationarity check, instruction-count and work-counter companion gates per PR | §5.2, §5.4 |
| 4 | A1 no traceability | High | Accepted: `covers:` tags, generated `coverage/matrix.json`, CI rule with a closed ledger, rendered on the release PR; hand-written seed matrix | §0.1, §8 |
| 4 | A2 66 P0 symbols no upstream test names | High | Accepted. Recount: 66 = 13 types + 53 values (the audit's 59 counted differently); each assigned an A-hand test, Tier C command, view test or type test | §1.8a |
| 4 | A4 families with no model tier | High | Accepted: each gap row closed via D2 commands, A2 tests and G-series e2e; per-family table | §8.2 |
| 4 | A6 ~10 Macro nodes untested; corpus may lack them | High | Accepted: node/field histogram from the corpus, synthetic per-node generator over all 41 nodes × 9 routes, M1 gate per node × route | §3.6, §3.6b, §8.3 |
| 5 | C1 80% gate meaningless | High | Accepted: 100% of non-ledgered cases; B-only ≥ 95%; P0 packages 100% minus listed divergences; percentage is dashboard only (supersedes SCOPE M3's 80%) | §2.7 |
| 5 | C2 ported config green with nothing ported | High | Accepted: `rust_executed`/`js_fallback` counters; M3 needs empty P0 `coverage.json` and zero P0 fallbacks | §2.2 |
| 5 | C3 ForeignNode hook list wrong | High | Accepted: hook set derived mechanically and checked against the Rust enum; `canMergeWhenEmpty`, `canInsertAfter`, `insertAfter`, `insertBefore`, `resetOnCopyNodeFrom`, `isTextEntity`, `canHaveFormat`, `isSimpleText`, `splitText`, `setTextContent`, `mergeWithSibling`, `select*`, `getTopLevelElement` added; `canBeTransformed` removed; one literal call-counter test per hook | §2.4 item 2 |
| 6 | A9 gate has no adversarial/differential fuzzing | High | Accepted: `diff/gate-fuzz` against lexical-service's own gate and editor, JSON-level and Loro-level mutations, release blocker on any difference | §3.6a |
| 7 | E1 presence invariant | High | Delegated to S8 R1 (`presence_converged`, `presence_expires`); mapped | §3.5, §8.6 rows 8, 10, 90–92 |
| 7 | E2 collab undo invariant | High | Delegated to S8 R1 (`undo_reverts_only_own`); S4 adds the model-level twin and e2e E17 | §3.5 item 3, §6.2 E17 |
| 7 | E3 no corruption fault | High | Delegated to S8 R1 (fault steps, `ClientBuild::Faulty`); mapped per S7 row | §8.6 rows 9, 11–13, 39, 40 |
| 7 | E5 wire compatibility only transitive | High | Delegated to S8 R1 (client golden transcripts, Miniflare runs); S4 adds the real-browser mixed-model run E11 with tables, code, comments, mentions | §3.5, §6.2 E11, §8.6 rows 5, 57, 59 |
| 8 | F3 benchmark measures the wrong editor | High | Accepted: `core` cell (the `macro` plugin variant, named) and `app` cell (the real Macro editor, flag off vs on); both gated | §5.1 |
| 8 | F4 no memory gates | High | Accepted: load (≤ 1.10×), typing growth (≤ 5%, no slope), 20-document open/close (≤ 2 MB, zero live editors, all handles finalized); eager `measureUserAgentSpecificMemory` | §5.3, §5.4 |
| 8 | F5 iOS measures the wrong process; no Android | High | Accepted: WebContent memory via `xctrace`/Web Inspector, batch timing with `os_signpost`, COOP/COEP verification as an M3 entry prerequisite, nightly simulator XCUITest, Custom Highlight API fallback check on iOS 15/16; Android emulator nightly + device at release | §5.5, §5.6 |
| 9 | G1 only documents covered | High | Accepted: E25–E30 cover channel/chat, email compose, comment threads, agent composer, collab surfaces and the remaining surfaces | §6.2 |
| 9 | G2 real input stacks missing | High | Accepted: event-trace replay fixtures per platform (iOS autocorrect/dictation/smart quotes, Android Gboard, desktop IMEs, spellcheck), replayed in Chromium/WebKit/Firefox; iOS simulator XCUITest and Android emulator Gboard nightly; Firefox nightly | §6.1, §6.4 |
| 9 | G3 AI peer and collab undo missing | High | Accepted: E15 AI peer, E16 AI suggestions (diff nodes), E17 collab undo incl. mixed flags | §6.2 |

### audit-r1-D, remaining findings

| Finding | Sev | Resolution | Where |
| --- | --- | --- | --- |
| A3 §1.9 wrong for `LexicalTableUtils` | Medium | Accepted: row corrected; §1.9 is an estimate no gate cites; four table ops get A-hand tests | §0, §1.9, §1.8a |
| A5 AMBIGUOUS has no rule | Medium | Accepted: one `ambiguous_<id>` pin test each, or a ledgered divergence | §1.8c |
| A7 web plugin tests deferred | Medium | Accepted: all 67 files classified now, with the milestone each must be recorded by | §1.9 web table |
| A8 byte-identical vs nondeterminism | Medium | Modified (per audit-r1-B Q20): inject clock and ids on both sides first, so `createdAt`/`snapshotDate` are compared, not masked; `normalize.json` masks only what can't be injected, symmetric, counted, ≤ 0.1% per route | §3.6 |
| B2 callback depth unspecified | High | Accepted: save/zero/restore depth; tape-callback calls stored in `tapes[n].invocations[k].calls`; nested update op with `parent`; three literal recorder tests | §1.3 2d, §1.4, §1.8d tests 2–4 |
| B3 containers leak raw objects | High | Accepted: deep lazy container proxies; membrane-transparency check (pass/fail and assertion count equal with and without the membrane) | §1.3 2e, 2f |
| B4 stale node versions | High | Accepted: handles are `(key, ver)`; replay resolves stale reads against the commit's persistent state; literal fixture | §1.5, §1.6 item 4, §1.8d test 6 |
| B5 cascade commits unnormalized | High | Accepted: commit cause recorded; named `cascadeCommits` normalization listed per fixture | §1.3 item 3, §1.6 item 1, §1.7 |
| B6 DEV vs prod oracles | Medium | Accepted: record both; `outcomeDev`/`outcomeProd`; Rust follows production behaviour with DEV message text; `dev-only-invariant` reason | §1.3 item 4, §1.7, §2.6 |
| B7 error capture incomplete | Medium | Accepted: `_onError` and `unhandledrejection` hooks, `error` op, unrecorded error fails recording | §1.3 item 3, §1.5, §1.6 item 3 |
| B8 microtask ordering inferred | Medium | Accepted: `tick` ops at every checkpoint | §1.3 setup, §1.5, §1.6 item 1 |
| B9 randomness not taped | Medium | Accepted: every clock and entropy source taped; un-taped read throws | §1.2, §1.3, §1.4 |
| B10 tape order over-constrains | Low | Accepted: strict default, `multiset` only via ledger `tape-order` | §1.4 |
| C4 DEV prototype check vs upstream patching/`vi.spyOn` | Medium | Accepted: write trap recomputes bitmask; throws only on native→JS flip after the first update | §2.4 item 2 |
| C5 jsdom blind spots | Medium | Accepted: playground e2e subset per PR on the shim from M3; E24 real chords for word/line deletes | §2.5, §6.2 E24 |
| C6 "≤ 1 wasm call" vs accessor design | Medium | Accepted: crossing defined as one wasm export call, bytes counted; changed records carried in the diff and cached so getters read JS memory; gate ≤ 2 calls and ≤ 256 bytes per plain char, equal at S/M/L | §2.4 item 10, §5.4 |
| C7 key/transaction API names | Low | Accepted: `end_update` renamed to S1's `flush`; `KeySource {PerEditor, Shared}` stated as a requirement on S1 R1 | §1.6 item 1, §2.3 |
| D2 missing commands | High | Accepted: all listed commands added (key commands through the bus, Tab, arrows, NodeSelection ops, decorators, TableSelection ops, `FormatElement`, code move/language, NodeState, clear editor/history, tags, `Copy` compared on R, read-only, foreign JSON, nested editors) | §3.2 |
| D3 no generator floors | High | Accepted: `generator_coverage` test with per-command and state-region floors | §3.2a |
| D4 90-keystroke cap | Medium | Accepted: patch `_cascadeCount` in the U oracle only (ledgered divergence); runs to 5k steps nightly | §3.1, §3.2 |
| D5 commit contents not compared | Medium | Accepted: dirty sets, changes, node-map identity diff, normalized keys and tags compared | §3.3 |
| D6 seeds unspecified; shim nightly only | Medium | Accepted: four seed sources with weights; `DIFF_TARGET=shim` per PR at 2k steps | §3.1, §3.4, §7 |
| E4 tiny seed documents | Medium | Delegated to S8 R1 (large seed, multi-frame floor); mapped | §8.6 rows 76, 89 |
| E6 executor/storage only on fakes | Medium | Accepted on the S4 side: S8's SC-1..4 suite and crash adoption run against real IndexedDB, Web Locks and BroadcastChannel in Chromium and WebKit as part of E19; the suite itself is S8's | §6.2 E19 |
| E7 S7 rows with no test | Medium | Accepted: every S7 §6 row mapped to a test id (S8 story/invariant, `doc_sync_core`, `document_session` or executor test) | §8.6 |
| F6 O(doc) gate on quantized timing | Medium | Accepted: `bench-counters` work counters, zero S→L growth for a mid-paragraph character; `criterion` for absolute µs | §5.2 item 8, §5.4 |
| F7 bulk/size/startup gates loose or missing | Medium | Accepted: CI-bound bulk rule, md import and parse at L ≤ 0.5, provisional D5 1,130,000-byte brotli cap (WP-59 measures real startup cost), Worker bundle headroom ≥ 20%, ai-editing-worker CPU gate, document-open gate in the app cell | §5.3, §5.4 |
| F8 harness defects | Medium | Accepted: fixed sample count without time cap, drain to quiescence, target paragraph rotated every 50 keystrokes | §5.1 |
| G4 thin paste matrix | Medium | Accepted: Word, Google Docs, Notion, Slack, Apple Notes, Sheets/Excel, VS Code, bare URL, markdown, image, Lexical JSON × six targets; cross-model clipboard both ways | §6.5 |
| G5 existing suites not flag-parameterized | Medium | Accepted: every editor-touching suite parameterized, both states green, list regenerated by the coverage tool | §6.3 |
| G6 cross-flag JSON needs determinism | Medium | Accepted: debug hook seeds ids and injects the history clock in both builds; E4 pauses use the injected clock; masks from §3.6 only | §6.1 |
| G7 no render equivalence | Medium | Accepted: E18 innerHTML with key bijection + screenshot diff ≤ 0.1% | §6.2 E18 |
| G8 real-browser sync faults | Medium | Accepted: E19 multi-tab crash, E20 server restart, E21 slow network + flaps, E22 permission change, E23 legacy content; mixed-model E11 extended | §6.2 |
| G9 missing keys/selection | Medium | Accepted: E24 | §6.2 E24 |
| G10 E13 absolute timing | Low | Accepted: E13 is correctness only; timing lives in the §5 app cell | §6.2 E13 |

### audit-r1-B test gaps

| Finding | Resolution | Where |
| --- | --- | --- |
| C-1 clipboard model half | Tier C `Copy` compares R's export; `clipboard_gaps` A-hand tests; matrix row | §1.8a, §3.2, §8.2 |
| C-2 plain-text absent | `hand::plain_text` (PT-01..16), e2e E25 single-line | §1.8a, §6.2 |
| C-6 CLEAR_EDITOR | `clear_editor_leaves_one_empty_paragraph`, Tier C `ClearEditor`, E25 | §1.8a, §3.2 |
| C-7 drop move semantics | Tier C `DropMove`, E24 | §1.8b, §3.2, §6.2 |
| F2a-1 table span reads in one transaction | literal test pinning the S3 rule as a ledgered divergence | §1.8a |
| F2a-15 / Q19 linkify-it | differential harness vs linkify-it 5.0.2; first literal test pins merge order | §3.6c |
| F2b-4 code Home/End guard | `home_end_in_paragraph_is_not_handled`, E24 | §1.8b |
| F2b-8 / P3-1 / A-2 / A-11 gate and route registry | `macro-export` Tier C profile with lexical-service's exact editor; registry parity test against `createEditor()`; gate tests for `code`→`custom-code`, language change, `list`→`task-list`; corpus legacy `list`/`code` case; gate fuzzer uses lexical-service's own editor | §1.8b, §1.9 lexical-service table, §3.1, §3.6, §3.6a |
| F2b-9, F2b-10, F2b-13, F2b-14, F2b-15, F2b-16, F2b-17, F2b-18 | one named literal test each | §1.8b |
| F2b-23 / A-12 legacy agent-context bodies | test for whichever S3 R1 decides, plus a counted shadow/corpus skip | §1.8b, §3.6, §3.7 |
| P3-4, P3-5, P3-6 absent / null / stamp | per-field absent/null round-trip tests; synthetic generator emits absent and null fields | §1.8b, §3.6b |
| P3-14, P3-15 image-markdown | named tests | §1.8b |
| R-1 / Q15 regress vs V8 case folding | regex differential over every `i` (and every other) static against V8, with U+017F/U+212A/U+0130/U+0131 corpus; literal `/s/i` vs `ſ` test | §3.6c |
| R-2/Q7, R-3/Q22, R-4/Q6, R-5, R-6/Q9 | named tests; R-5 ledgered `lone-surrogate` with a corpus scan | §1.8b, §2.6 |
| Q1 `/html` throws on lists | JS fix first, then compared; until then skipped and counted; `list_markdown_renders` | §1.8b, §3.6 |
| Q3 / Q20 injected clock and ids | injected on both sides; not masked | §3.6, §1.8b |
| Q4 diff block order | E16 | §6.2 |
| Q11 unknown nodes | model round-trip and route-error tests | §1.8b |
| Q18 integer-like key order | `integer_like_keys_hoist_first_in_pass_through_objects` | §1.8b |
| 57 (not 56) `SupportedNodeTypes` classes | corrected in the Tier C profiles | §3.1 |
| every other F2a-/F2b- fix | lands with a literal test whose `covers:` names the finding; `lexical-coverage` lists any without | §1.8b |

**Counts.** audit-r1-D: 57 findings resolved (51 accepted, 1 modified (A8), 5 delegated to
S8 R1 with S4-side mapping or scenarios (E1, E2, E3, E4, E5); E6 and E7 accepted on the S4
side). 0 rejected. audit-r1-B: 21 test-gap rows resolved, 0 rejected.

**Docs outside S4 this revision depends on.** S1 R1: `KeySource` and the `flush` name
(already S1's); S3 R1: CR-17 two registries, the F2a-1/F2b-23 decisions; S8 R1: the
§E invariants, faults, seeds and transcripts named in §3.5 and §8.6. SCOPE M3's "Tier B ≥
80%" and the 90-keystroke cap are superseded here (SCOPE is read-only for this revision).

## R1 consistency pass

Checked every `lexical_model` name S4 uses against S1 Revision R1 (the source of truth):

- §1.6 item 1 already uses S1's `Transaction::flush` (`end_update` survives only as the R0
  history note). Item 3 gains the `ApplyError::committed` rule: an undo/redo or other
  `set_editor_state` step that fails after its early commit is compared against
  `committed.last().next` (S1 §15.2, F-24).
- §1.6 item 7: `Commit::diagnostics` does not exist in S1; `log` ops compare against captured
  `tracing` events.
- §1.8 / §1.8a literal tests rewritten to S1 signatures: `Editor::builder(EditorMode::Headless)`
  (no default mode), `let mut editor`, `create`/`create_text` return `Result`, `append(parent,
  &[key])`, text read via `text_data(id)?.text` and written via `tx.text(id)?.set_text_content`
  (no `node_mut`/`set_text`), `EditorState::to_json() -> Result`; `ListItemNode::default()` →
  S3's `create_list_item_node`.
- §2.3: `KeySource::Shared` is one `SharedKeyCounter` per wasm instance (not a `Cell<u32>`), and
  `resetRandomKey()` resets it with `SharedKeyCounter::reset`.
- §2.4 item 2: the hosted hook set is S1 §3.2's hooks plus S1's explicit non-hook list
  (`isSimpleText`, `splitText`, `mergeWithSibling`, `select*`, `getTopLevelElement`, …); the CI
  check compares against both, and each non-hook gets a "base behaviour, zero JS calls" test
  instead of a call-counter test. Hooks are named with their S1 counterparts
  (`reset_on_copy`, `create_parent_element`, `adjust_export_json`, `after_clone`, `coerce_*`).
- §3 differential: R is driven with `apply(Input, now)`; R's `Editor` is built fresh per run
  instead of calling `reset_key_counter` through `EditorCore`; `TextFromView` carries
  `selection` (S1 F-17); `ParseForeign` runs with `opaque_unknown_types` off on R.
- §4 properties: P9 uses `Output::diff`/`Commit::diff(&DiffOptions)`; P10 uses
  `changes.mutations`; `arb_command` is a test-crate strategy (S1 has no `testing` feature).
- Q11 tests name the D-23 ruling: round trip with `opaque_unknown_types(true)` (collaborative
  session), route error with the S3 registries (off).

## R2 resolutions

Revision: R2. Inputs: `audit-r2-2.md` (all test-side findings), `audit-r2-4.md` (the test items:
B2, H6, H7's S4 side, M7, L4, L5), `audit-r2-1.md` (one regression test per fresh divergence),
`audit-r2-3.md` (S4 references). "Accepted" means the fix is in this spec; "delegated" means
another spec owns it and S4 states what it reads or requires.

### audit-r2-2

| Finding | Resolution | Where |
| --- | --- | --- |
| G-1 per-id CI rule has no input (23 of 1,212 ids named) | Accepted. The per-id list is generated: `S4-matrix-gen.ts` (repo: `coverage/gen-matrix.ts`) reads S1/S2/S3/S7/S8 and S4's named-test tables and assigns every S2 behaviour id and every export one primary test id or a closed-enum ledger entry; the full matrix is `S4-matrix.tsv`. Rust-owned MODEL/BRIDGE ids get one literal test each (`s2::<family>::<id>`). (b) the recorder records V8 `Src`-range hits per fixture; (d) Tier B credit only with `rust_executed > 0`; the CI rule matches `covers:` tags in the row's file and is a ratchet (`pending.txt`). (a) the S2 `Src` column and (c) the `/// s2:` owner lines are delegated to S2 and S1/S3; S4's CI rule reads the owner lines | §0.1, §0.2, §1.3 item 5, `S4-matrix.tsv` |
| G-2 duplicate SEL ids | Accepted on the S4 side: the generator names the §3D copies `LSEL-nn` (S2 R2 owns the rename); any other duplicate is qualified and printed | §0.2 |
| G-3 shim and native view have no spec | Delegated to S10. S4 splits the shim into `ShimBackend` `conformance` (Tier B, dev) and `session` (production) with a parity test, and generates the shim's per-name tests (`exports.test.ts`, `types.test-d.ts`, `view_gaps.test.ts`) from the matrix | §2.8, §0.2 |
| G-4 M3 gate unsatisfiable (16 P0 names must run JS) | Accepted. The gate covers P0 MODEL/BRIDGE names whose owner is a Rust item; every other P0 name of an aliased package is a generated `js-by-design` ledger entry (32 at R2: the audit's list, plus `registerRichText`, `$applyNodeReplacement`, `mergeRegister` and the other S1 n/a names; `TableDOMCell`, a type, gets the type test instead), and the reporter fails if the ledger and the matrix disagree | §2.2, §2.6, §0.1 |
| G-5 package command constants | Accepted with S3's proposed default (one `static CommandKey` per package command): `hand::commands_gaps::package_command_keys_dispatch_to_mapped_handlers`. Until S3 lists the statics, the generator reads those constants as not ported and gates them `js-by-design`; the row flips by itself when S3 maps them | §1.8a |
| G-6 transformer coverage (15 rows missing, order-sensitive lists, "const in API list" cannot work) | Accepted: (a) firing trace in the recorder; (b) one order test per list (`internal/external/all/custom` and the five upstream groups); (c) §8.5 per const, the missing files added (`customTransformers.ts`, `index.ts`, `unknownFallback.ts`, `utils/html-entities.ts`, `utils/parsers.ts`, `utils/quote-markdown.ts`, `utils/markdown-mentions.ts`, linkify-it) | §1.3 item 6, §8.5, §0.2 `tf`/`tf-order` rows |
| G-7 Rust ports no upstream suite reaches through Rust | Accepted: config 2 aliases `clipboard`, `plain-text`, `overflow`, `text`, `offset`, `headless`, `html` (export); literal tests for `$getClipboardDataFromSelection`, `$insertDataTransferForRichText`, `$handleRichTextDrop`, `$insertDataTransferForPlainText`, `$writeDragSourceToDataTransfer`, `$createOverflowNode`/`$isOverflowNode`, `$rootTextContent` | §2.2, §1.8f |
| G-8 eight S7 §6 rows with no test (111, 112, 115–120) | Accepted, plus row 110 (no direct test either) and S7 R2's new row 123; rows 109, 113, 114, 121, 122 now cite their S8 stories | §8.6 |
| G-9 Lexical internals Macro touches | Accepted on the S4 side: one `view_gaps` test per field, as `priv` matrix rows; the S2 §2b inventory and the shim ownership are delegated to S2 and S10 | §1.8h |
| G-10 `@lexical/extension`, history extensions, html render context half-placed | Delegated to S2/S3 (retarget, not-ported lists). The generator already places them: Tier B + `not-ported` where S3 lists them, `blocked:no-rust-owner` where nobody does (2 rows left at R2: they fail the CI rule until S2/S3 place them) | §0.2 |
| G-11 tests contradicting "no Rust counterpart" | Accepted: `isCurrentlyReadOnlyMode` and `getCodeLanguages` move to `view_gaps.test.ts`; `INSERT_CHECK_LIST_COMMAND` per G-5 | §1.8a |
| G-12 stale S1/S2 statements | Not S4's | — |
| §4 Macro-used VIEW exports with only Tier B coverage | Accepted: `view_gaps` tests for `$getNearestNodeFromDOMNode` (+ E24), `getDOMSelection`, `isHTMLElement`, `setDOMUnmanaged`, `IS_APPLE`, `IS_IOS`; `EditorConfig`, `EditorThemeClasses` through `types.test-d.ts` (every type row gets the type test) | §1.8f, §0.2 |
| T2a contradictions | Accepted (G-5, G-7, G-11) | §1.8a, §1.8f |
| T2c `MediaNode`, `WatermarkNode` | Accepted: MediaNode via ImageNode/VideoNode; `nodes::watermark_remove_is_noop` | §8.3, §1.8b |
| §5 item 7 corpus scan for MagicChip status / ReplyTarget parent keys | Accepted: S4 owns `corpus::scan_magic_chip_status`, `corpus::scan_reply_target_parent_keys` | §1.8b |
| §5 item 13 "if the S3 cut stands" | Accepted: only `shadow::skips_legacy_agent_context_bodies` remains | §1.8b, §3.6 |
| §5 item 17 "317 names" | Accepted: 382 | §2.1 |
| `PATCH-NONE` has no class | Given a real test: `macro_profile::no_other_lexical_patches` | §1.8g |

### audit-r2-4 (test items)

| Finding | Resolution | Where |
| --- | --- | --- |
| B2 conformance wasm surface has no owner; S4 named the folded `lexical_model_wasm` | Accepted: dev-only cdylib `crates/client/lexical/lexical_conformance_wasm` with its full export list (`CoreHandle` for Tier C R and the perf `core` cell, `EditorHandle` sharing the Tier A dispatch table for the shim, compat names in the API index, debug counters, `register_foreign` over S1 §4.4's `ForeignHooks`), builds, and the never-shipped CI assertions. All three `lexical_model_wasm` references replaced | §2.8, §2.1, §3.1, §5.1, §7 |
| H6 wasm32 replay cannot use the native harness | Accepted: `FixtureSource` trait; `tests/replay_wasm.rs` with one `#[wasm_bindgen_test]` per fixture package generated by `build.rs`, fixtures read through a node `fs` loader (not embedded), failures listed by fixture id; `just lexical-replay-wasm` with `wasm-bindgen-test-runner` | §1.6, §1.2, §7 |
| H7 (S4 side) | Accepted: Tier B, `DIFF_TARGET=shim` and the perf `core` cell use `lexical_conformance_wasm`; the `app` cell measures the shipped `document_session_wasm` | §2.8, §5.1 |
| M7 CI filter misses the session crates and web wiring | Accepted: `document-session` filter with the build, size gate, desktop `coreWasmPackages` check and the wasm32 `workspace-hack` check | §7 |
| L4 executor package | Accepted: S4 now uses S7 §4.3's `packages/collaboration` | §0.1, §7, §8.6 |
| L5 upstream tarball in CI | Accepted: CI cache keyed on `upstream.lock`'s sha256 | §7 |

### audit-r2-1 (fresh divergences)

All 58 findings get a regression test id (§1.8e): R2-01…R2-37 behavioural tests (upstream
expected values; D-24, D-25 and R2-26 asserted as ledgered divergences if S1/S3 keep them), and
R2-38…R2-58 compile-and-run API-shape tests in `tests/api_shape.rs`. The matrix carries them as
`div` rows with `covers: S1:R2-nn`. The fixes themselves are S1's and S3's.

### audit-r2-3

`audit-r2-3.md` names no S4 section. S8 invariants that cannot be computed are S8's. S4 reads S8
only by name (§8.6) and through `covers: S7:<n>` tags, so an S8 rename is picked up by the
generator from the tag; a row whose test disappears shows as `MISSING` and fails
`just lexical-coverage-seed --check`.

### Counts (from `bun S4-matrix-gen.ts` on the R2 specs)

2,793 rows: 1,140 exports (904 MODEL/BRIDGE), 1,292 behaviour ids (1,213 MODEL/BRIDGE; 1,012
need a Rust test, the rest are VIEW, upstream-JS or reference and run in Tier B with a ledger
entry), 9 private fields, 43 nodes, 18 routes, 99 transformers, 11 transformer lists, 123 S7
rows, 58 divergence regressions. 32 `js-by-design`, 2 `blocked:no-rust-owner`
(`@lexical/extension` names for S2/S3), 0 rows without a test. The specs were still being
revised in parallel when this ran, so line numbers in the `source`/`also` columns move; the
generator is the source of truth and `--check` catches staleness.

**Docs outside S4 this revision depends on.** S1 §4.4 (`foreign-nodes`), the `/// s2:` owner
convention (S1/S3), S2's `Src` column and `LSEL` rename, S3's package `CommandKey` statics
(G-5), S7 §4.3/§4.6 (executor package, packaging). R2.1 replaces "S1's `wire` feature" with
S7's `session.bop` codec and "S10 (the shim and its `session` backend)" with S12 §1–§2.

## R2.1 consistency

Applies S1 R2.1's "Changes other specs must make" (S4 items), S1 R2's S4 follow-ups, and S12
§0.2's S4 rows. Workers on WP-05 are unaffected: no recorder, fixture schema or test id they
depend on was renamed.

| Item | Change |
| --- | --- |
| S1 R2-18 / §8.8 Tier C masking | §3.3 `outcome` row: the composition key is masked after an `Err` until the next successful step (D-16). §1.8e R2-18 row cites D-16, not D-25 (S1's D-25 is R2-26) |
| S1 fixtures R2-01, R2-02, R2-03, R2-06, R2-22, R2-23, D-25 | Already in §1.8e; the R2-26 row now asserts S1 §19.2 D-25 (relocation only for `Active`) |
| S1 G-11 `read_only_mode_inside_read` | Already moved: §1.8a `isCurrentlyReadOnlyMode` is `view_gaps.test.ts` (R2) |
| S1 B2 / R2.1 `foreign-nodes` | §2.8: `lexical_conformance_wasm` depends on `lexical_model` with `foreign-nodes` (only crate to enable it); `js-nodes` stays this crate's own feature |
| S1 §11.4 / F18: no `wire` feature | §2.8: `CoreHandle::apply` decodes `Input` and encodes `Output` with S7's `session.bop` codec; `CoreHandle::new` takes `CoreConfig` fields as primitives; view host via `EditorBuilder::view_host`. §1.8e R2-58: `api_shape::input_output_derive_debug_clone` (compile) and the round trip moves to S7's crate as `session_bop::input_output_round_trip`. §3.1 no longer says "postcard `Input`" |
| S1 §4.4 `PendingUpdate` | §2.8 `EditorHandle` holds `Editor` + `Option<PendingUpdate>`: `begin_update` opens and suspends, `call`/`flush` resume and suspend, `commit` resumes and commits (`StaleSuspendedUpdate` is a `JsError`); §2.4 item 5 says so |
| S1 §4.4 runtime registration | §2.4 items 5 and 7: JS `registerCommand`/`registerNodeTransform` after `createEditor` use `register_foreign_listener`/`register_foreign_transform`; `createState` configs are `ForeignStateConfig` with `set_foreign_state`/`Read::foreign_state`. §2.8 adds `EditorHandle::register_listener`, `register_transform`, `unregister` |
| S1 §14.4 owners for the 2 `blocked:no-rust-owner` rows | §1.8f rows for `NormalizeTripleClickSelectionExtension` (model `lexical_model`, plugin S3 `lexical_rich_nodes::normalize_triple_click`, view web-view) and `ClickAfterLastBlockExtension` (model S3 `lexical_rich_nodes::click_after_last_block`, view web-view); S2's retarget gives them `rust:` owners. 0 blocked rows |
| S1 R2.1 new tests | New §1.8i: type table vs per-instance flags, `BuildError::NoFlagProbe`, listener table, `SetViewSelection` elision, `take_initial_output`, `export_json` vs `export_node`, `ViewSelection::Table`, `fix_focus_overselection`, `MergeTracker::classify` without `has_current`, `PendingUpdate` staleness, shared follow-up rounds |
| S1 §14.2 (no `CommitHook`) | §1.8e R2-48 row cites `Plugin::after_commit` with one follow-up per round shared by every plugin |
| S12 §0.2 S4 §2.1, §2.5 | `src/view/` is not in the shim: the view code is imported from `packages/lexical-wasm-view` (§2.1 layout, §2.3 compat table, §2.5, §7 bump step 5); `pkg/` is `lexical_conformance_wasm` |
| S12 V-1 (shim dev-only) | §2.8: one `ShimBackend` (`conformance.ts`, via `ConformancePort`); the R2 `session.ts` production backend and `backend_parity.test.ts` are dropped. S10 references become S12 |
| S12 §0.2 S4 §3.1 | `DIFF_TARGET=view` per PR (2k steps); `DIFF_TARGET=shim` nightly only (200k). §3.1, §3.4 budgets and §7 table updated |
| S2 R2.1 targets (`not-needed`, S12 §4) | `S4-matrix-gen.ts`: an unmapped export whose S2 target is `not-needed` is `upstream-js` with `ledger:not-ported(S2:target)` (or `js-by-design` for an aliased P0), not `blocked` |
| sharedPeerIds | No S4 change: S4 only names the comment gate's identity-key strip (`id`, `peerId`, `sharedPeerIds`, `local`), which is lexical-service's rule, not `synced_json` |
| Matrix | Regenerated on the R2.1 specs: 2,793 rows, 0 `blocked:no-rust-owner`, 0 MISSING; `bun S4-matrix-gen.ts --check` passes |
