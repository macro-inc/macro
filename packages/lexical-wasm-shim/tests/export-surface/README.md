# Complete Lexical export contract

`bun tests/export-surface/run.ts` discovers the Lexical specifiers imported by
production web, core nodes, view and collaboration sources. It compares complete
namespaces, not only the names those callers currently select. Every upstream
package must be the locked v0.45.0. It emits the actual implementation's ordinary
declarations with the producer TypeScript 6.0.3 and `noEmitOnError`, without
rewriting either declaration graph.

Each namespace gets an isolated runtime probe. The root is the actual facade.
The existing `@lexical/*` packages stay unchanged and are bundled with the same
exact root substitution used by the Macro harness. The bundle input manifest
rejects any Original core runtime leakage. Prism remains on its real CommonJS
loader to preserve its language initialization order. This is not an alias for
missing facade exports or a claim that the external packages were reimplemented.

The JSON report lists every missing/extra runtime and declaration export, every
runtime kind/cheap function-arity difference, and every namespace initialization
failure. A blocked namespace never counts as matching or as an empty module.
Current gaps deliberately fail the permanent `check:exports` package gate. There
is no export-name allowlist, expected-failure ledger or feature flag exemption.

Run `bunx vitest run --config tests/export-surface/vitest.config.mts` for the guard
controls. They include an intentionally incomplete fixture whose consumer must
fail, preventing resolver bypass from making unchanged Original packages appear
compatible. This guard complements the full observable declaration/behavior
oracles; matching names cannot establish method semantics or native acceptance.

The generated web Typecheck workflow runs the standalone comparison controls
and the full contract for all web and package changes. It uploads the complete JSON report and
ordinary emitted declarations even when a namespace fails. Set
`LEXICAL_EXPORT_OUTPUT` to an external evidence directory for a stable report
location; otherwise each invocation uses a fresh temporary directory.
