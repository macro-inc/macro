# Contact decorator Normal Enter boundary

## Current canonical package

This fixture now imports the canonical ordinary document-session package built
by `just build-document-session-wasm` in `apps/web`. It does not load a private
`wasm/` or `wasm-root-id/` directory. Before a new run, build that package, run
`bun scripts/check-decorator-browser-wasm.ts`, then typecheck with
`bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tsconfig.decorator-browser-tests.json`.
The current Playwright config requires the real outputs, checks their declaration
against the generated consumer ABI, and records their actual hashes in metadata.
A missing output or mismatched declaration fails; there is no stub or skip.

## Archived build evidence

Earlier manifests, seal-specific descriptions and captured evidence describe
the archived builds, not this canonical target. Reproduce those runs only with
their archived fixture source and matching artifacts. They do not qualify a new
canonical-package run, and the typecheck change supplies no new browser result.

This fixture mounts the actual Source wrapper or the real native session/view with
the same registered Contact component. The narrow native host supplies published
selection and a synchronous Normal-priority Enter listener. Programmatic Source
`KEY_ENTER_COMMAND(null)` is paired with `port.nativeEnter.dispatch()`; ordinary
selection inputs use `inputSettled` outside the callback. An earlier Normal
listener may clear pending selection while Contact still reads published UI
selection until commit. Every failure path closes the actual fixture before its
browser page.

The source-only before/after cohort compares literal model, DOM and shadow-root
strings at initial, selected and post-Enter observations in Chromium, Firefox and
WebKit. The compiled-dependency verifier checks the exact app-cache source maps
and the responses loaded by each browser for pristine Lexical and code-core.

The native fixture pins all five files from the matching44de artifact. The raw
factory snapshot import remains a failing full-model control: Source reads add
`environmentTags:null`, while that artifact omits it. A separate explicitly
selected `CONTACT_NATIVE_TRACE=canonical-reimport` cohort reads an actual saved
Source export from `CONTACT_CANONICAL_INPUT` and imports those exact bytes in
both engines. It establishes component/Normal-Enter behavior only; it cannot
close the native metadata producer gap. Captures and reports remain separate.

The fixture has no actual split manager. Enter handling and published selection
are exercised, but successful navigation is not claimed. It is not the complete
Macro decorator registry or a preview installation.

Run from the isolated app with the three real browser executable paths and
`CONTACT_TEST_REPORT` / `CONTACT_TEST_OUTPUT` set to independent output paths.
The before cohort uses `CONTACT_PHASE=before`; later Source runs compare against
its preserved captures. `contact.browser.e2e.ts` covers Source preservation;
`native.browser.e2e.ts` covers the explicitly selected native input trace. Keep
all prerequisite snapshots and execution-bound provenance in the owning external
proof directory, rather than changing inputs or normalizing comparison output.

The native document body adds the real Contact row alongside User mentions in
its existing decorator registry. Its app-owned Contact context is released
through the same listener scope before runtime close, including failed mounting.
Leaf controls do not establish installed-app acceptance; validate this app mount
with the coherent candidate's matched native package.
