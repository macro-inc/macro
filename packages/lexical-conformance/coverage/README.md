# Lexical traceability

`just lexical-coverage-seed [--check]` derives the 2,793 specification rows from
`docs/design/lexical-port` and the checked-in fixture index. It never scans a local
upstream checkout. `seed-markdown.ts` parses the documents; `seed-plan.ts` resolves
owners and primary tests; `gen-matrix.ts` emits the normative TSV.

`just lexical-coverage [--check]` writes or verifies `matrix.json` and the
spec-cited policy `ledger.json`, and lists **every uncovered P0 symbol**. The
matrix preserves API-call candidates, qualified fired-transformer candidates,
observed S2 ranges, source tags and Rust implementation owners. Observed ranges
and secondary tags do not replace the named primary test.

`pending.txt` starts with every required row. It may only shrink relative to
`--base=<revision>` (default `origin/main`, CI uses the fetched PR base SHA).
Unlisted gaps fail. `--initialize` is accepted only before this file exists;
it is not an update mechanism. `--milestone=M1` rejects pending M1 rows.

Recorded JavaScript fixtures alone certify no Rust coverage. `just lexical-replay`
executes every admitted fixture, writes per-case pass/fail/ledger evidence to
`results/replay.json`, and preserves Cargo's failing exit code. The fingerprint
covers the exact corpus, Rust sources, vendored sources, manifests/lockfile and
Rust configuration. Ledgered cases never count as passing replay.

`run-tests.ts` runs the four Rust library suites separately and writes matching
literal test results. New property-test regression seeds are preserved under
ignored `results/proptest/` while committed input seeds remain unchanged. Handwritten evidence must match a live `covers:` tag,
the named primary test, its source hash, and the implementation fingerprint.
Ignored tests, test-gated Rust scopes and TS `s2:` comments cannot certify Rust
implementation ownership. Compound cfg attributes mentioning tests are
conservatively excluded, leaving ambiguous ownership pending.
Tier B evidence additionally requires Rust-execution counters for Rust-owned rows;
policy ledger entries do not claim that Tier B ran.

CI clears old evidence before execution. Runtime results are ignored by Git and
are uploaded as artifacts, not committed into the static matrix. All checks fail
closed on stale or incomplete replay evidence. A missing result leaves the row
uncovered; it never makes a pending row pass.

`just lexical-replay-wasm` embeds the same complete corpus and executes it using
wasm-bindgen-test in Node, preserving exact ledger diagnostics and allocation-key
checks. Model divergences remain failing results, not new ledger entries.
The wasm job also runs the available Tier C upstream text/paragraph subset at
10,000 fixed-seed steps. Broader profiles and nightly million-step budgets remain
pending their generator work packages.

The session check first verifies every client crate excludes workspace-hack. The
artifact/size/desktop gates start when `document_session_wasm` lands. Until then
it writes an explicit pending summary. Later Tier B/shim, browser, fuzz, perf,
simulation and corpus gates in S4 remain pending their implementation WPs; this
workflow does not invent successful results for them. Native/wasm replay failures
still fail the PR gate today.

Run checks in the package:

```sh
bunx tsc --noEmit -p coverage/tsconfig.json
bunx vitest run --config coverage/vitest.config.ts
bunx @biomejs/biome check --config-path coverage coverage
```
