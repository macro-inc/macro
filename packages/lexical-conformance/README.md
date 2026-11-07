# Lexical Tier A recorder

Development-only tooling for the pinned Lexical 0.45.0 oracle. The independent
package and lockfile keep the recorder's Node/Vitest versions separate from the
shipped app's patched Lexical dependencies.

```sh
just lexical-fixtures
just lexical-fixtures --check
```

The command verifies the archive SHA-256, extracts it under this worktree's
`target/lexical-upstream`, applies the optional recording hooks, then runs the
upstream unit tests in three isolated lanes: development recording,
production recording, and development with the membrane disabled. Each lane runs the archive and this worktree's `packages/lexical-core` in separate
processes. The latter pool uses the S4 markdown indent of 2; upstream uses 4.
Macro source, its Loro helper and required JSON input are copied into the disposable
oracle tree; their bytes and the recorder lockfile participate in fixture provenance.
Source files and tests in the archive are otherwise unchanged. Dependency installation uses
the checked-in lockfile and disables install scripts.

A passing upstream test produces a schema-2 fixture only after the JavaScript
interpreter replays its calls, callback tapes, commit snapshots, errors, entropy,
and final state. Empty editor-root mounting is setup infrastructure; DOM property
reads in the original test body are still classified as view assertions. The disabled-membrane run must have the same test result and
assertion count. Development/production differences are explicit in
`outcomeDiffers`; the main trace is the production oracle. `--check` regenerates
in `target/lexical-recording` and compares the complete file set and bytes.

`fixtures/index.json` contains every reported case, its classification and reasons,
called APIs, V8 source-range hits, and successful transformer hooks. Unsupported
values and failed self-replays remain visible as B-only cases; they never become
partial passing fixtures. Cases with mutating callbacks are A-hand, and DOM
assertions are view cases. Fixture filenames hash the full test identity so long
or punctuation-heavy upstream names are safe on every filesystem.

Import-time entropy is captured separately and currently rejects admission because
the interpreter reuses loaded modules. The S4 markdown import/export loops omit their HTML assertion projection from the
model trace while the original test assertions still run in all three lanes.
HTML-seeded exports begin a partial fixture at the first model read. The initial
JSON, selection, allocation keys, node-map ordering and next key counter are
restored explicitly; replay never runs the HTML setup.
Unsupported callback or plugin state remains an indexed exclusion. Shiki loader
calls also remain excluded: their warm-cache return values cannot initialize a
fresh replay without an explicit asynchronous bootstrap phase. Passing
regeneration checks proves the admitted corpus is stable; it does not claim that
every upstream test is recordable.

The repository privacy scanner also excludes fixtures containing contact values;
their index rows use `repository-privacy-filter`. Oracle values are never redacted
into passing fixtures, and recording does not add privacy exceptions. A test name
that contains a flagged value is retained under a stable opaque ID. The complete
output, including the index, is scanned before publication.

Only admitted fixtures publish `s2Hits` and `transformersFired` as conformance
evidence. Rejected cases retain diagnostic coverage under `target/lexical-recording`;
their asynchronous DOM cleanup is not part of a replayable fixture.

The per-file expected A-rec counts from S4 are retained in `record/inventory.json`.
The pinned archive has more cases than that inventory; mixed files supply aggregate
counts rather than exact A-rec test labels. Runtime admission and all exclusions
are therefore reported against every observed case, without inventing a mapping.

The source-range manifest in `record/s2-ranges.json` is the resolved file/line
citations from the S2 feature inventory for this upstream pin. V8 offsets are
mapped through the oracle's source maps and back through `hooks.patch` before
intersecting these citations. Mapped points belong to their innermost source
function; absent child counters cannot inherit an enclosing V8 range, and
zero-count branches remain excluded. Inserted instrumentation is not coverage;
coverage is evidence, not a replacement for the per-id primary-test gate.
Recorder forks disable V8 optimizing compilers to keep helper counters stable.
Duplicate test titles use declaration order rather than result arrival order.

For recorder development, `--filter=LexicalNormalization` runs a selected upstream
file; `--filter=macro:<file>` selects lexical-core (`macro:` runs its entire pool).
These filters replace the corpus, so regenerate without a filter before committing.
Use `bun run test` and `bun run check` in this package for the recorder regression
suite and TypeScript checks. The regression suite includes the eight S4 §1.8d
cases on real upstream objects, plus isolated encoding and attribution checks.

No recorded test callbacks are executed by `replay-js.ts`. Only the fixture's
concrete operations, source-exported helpers and explicitly registered plugins run.
Nested inline transformer callbacks use the same strict invocation tapes as direct
callback arguments. Regular expressions retain source, flags and lastIndex;
headless factories, generated namespaces and named node replacements retain their
creation behavior. Iterator results use identity handles (`$iterator`) so their
`next` calls and yielded caret/node objects replay independently. Named code
highlighting and tab-indentation plugins run as oracle plugins; the known upstream
Tab mock is encoded only at `KEY_TAB_COMMAND` as S4's `$event` payload. Fixtures
that allocate highlight nodes declare `codeHighlight`; JavaScript replay still
compares exact upstream snapshots. Calls
originating inside upstream source are excluded using both call-site attribution
and a depth guard; callback scopes restore depth in `finally`. Cached proxies
preserve identity, while shadow targets permit reads from frozen selections.

The recorded oracle is derived from upstream Lexical; its MIT notice is retained
in [UPSTREAM-LICENSE](UPSTREAM-LICENSE).

Schema-2 additions used by this corpus: `$regexp` carries `flags` and `lastIndex`;
`$iterator` binds iterable-iterator identity; caret slices use `$caret` with `type:
"slice"`, `caret`, and `distance`. Editor config records `headless` and
`namespaceGenerated`. Config `nodeClasses` maps registered node types to source
`$fn` references, including classes configured without any direct API call.
Partial initial states carry `keys` (preorder), `nodeMapKeys`
(insertion order), and `nextKey` alongside JSON and selection. Downstream fixture
readers must support these explicit fields; no allocation keys are normalized away.

The same command checks the synthetic JSON node corpus and source editor
registries before recording Tier A. Run
`bun packages/lexical-conformance/corpus/synthetic.ts --check` from the repository
root to verify that fixed corpus independently. It compares all 57 registered
node classes (41 custom), both import configurations and all eight registry
configurations, using an injected clock and deterministic nanoid dependency.
