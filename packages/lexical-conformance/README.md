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
upstream unit tests in three isolated processes: development recording,
production recording, and development with the membrane disabled. Source files
and tests in the archive are otherwise unchanged. Dependency installation uses
the checked-in lockfile and disables install scripts.

A passing upstream test produces a schema-2 fixture only after the JavaScript
interpreter replays its calls, callback tapes, commit snapshots, errors, entropy,
and final state. The disabled-membrane run must have the same test result and
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
the interpreter reuses loaded modules. DOM-built partial initial states and
unsupported callback or plugin state also remain indexed exclusions. Passing
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

The source-range manifest in `record/s2-ranges.json` is the resolved file/line
citations from the S2 feature inventory for this upstream pin. V8 offsets are
mapped through the oracle's source maps before intersecting these citations;
coverage is evidence, not a replacement for the per-id primary-test gate.

For recorder development, `--filter=LexicalNormalization` runs a selected upstream
file. It replaces the corpus, so regenerate without a filter before committing.
Use `bun run test` and `bun run check` in this package for the recorder regression
suite and TypeScript checks. The regression suite includes the eight S4 §1.8d
cases on real upstream objects, plus isolated encoding and attribution checks.

No recorded test callbacks are executed by `replay-js.ts`. Only the fixture's
concrete operations and the explicitly registered upstream plugins run. Calls
originating inside upstream source are excluded using both call-site attribution
and a depth guard; callback scopes restore depth in `finally`. Cached proxies
preserve identity, while shadow targets permit reads from frozen selections.

The recorded oracle is derived from upstream Lexical; its MIT notice is retained
in [UPSTREAM-LICENSE](UPSTREAM-LICENSE).
