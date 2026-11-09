# Native preview install check

Run all six checks for every native preview candidate before installation, then
repeat against the installed artifact. Use an owned browser and synthetic account
in the private dual-stack network namespace; never drive the shared browser.

From `apps/web`, run `nice -n 19 bun scripts/editor-live-check/run.ts PRIVATE_CONFIG.json`.
The private JSON config has `origin`, `existingDocumentURL`, `storageState`
(an owned Playwright authentication file), `chromium` (the pinned executable),
`output` (a private evidence directory), and `expectedWasmSHA256`.
For a private pre-install test, optional `candidateArtifacts` names the immutable
complete native artifact directory. Only this owned browser receives the exact
candidate glue/WASM pair; the preview server stays unchanged. Results explicitly
say `candidate-browser-artifact-overlay`, never installed. Omit this option for
the mandatory post-install check.
Do not commit authentication, document payloads, or generated browser evidence.
The runner requires the actual served native EditorView module and verifies every
observed WASM response against the expected artifact hash. It fails closed on
missing modules, a different artifact, page errors, incomplete checks, or failed
assertions. It does not activate the compatibility core.

The six checks are existing document, new document, typing, undo/redo, sign-in,
and common-block persistence/reopen. The final check sends source-authored rich
clipboard data through the application's paste handler. The clipboard boundary
is supplied; this does not qualify system clipboard or each creation affordance.
It includes heading, list, checklist, custom code, table, quote, link, user mention,
equation, image and published comment anchor. The comment fixture does not create
a remote discussion. There is no state setter, debug global, fake native reference,
or replacement renderer.

Durability requires a document protocol ACK for the emitted update and a matching
committed native WAL row marked delivered, or a committed snapshot cover for that
same observed owner/sequence. Reads finish on readonly transaction completion.
An arbitrary wait, a snapshot alone, an empty WAL, rendered counts, or local recovery
cannot substitute. The test compares full JSON, every durable ID and the DOM after
both a warm reload and a new browser context that receives authentication only,
without copying IndexedDB. Attribute order is canonicalized; attributes, node keys,
text and child order are retained. Missing renderers or any mismatch remain failures.

The normal-size install fixture is independent of the mega-paste gate. Mega-paste
uses the frozen external HTML and trusted system clipboard recipe, and requires
its own ACK, committed delivery and warm/fresh-server restoration. A server row-size
failure blocks that gate even when a normal document passes.

`contract.test.ts` exercises validator controls only; it is not native persistence
or browser acceptance. Run `bunx vitest run --config scripts/editor-live-check/vitest.config.ts` for these controls and
`bunx tsc -p scripts/editor-live-check/tsconfig.json` for the tooling type check.

The common-block persistence fixture reads the actual mounted view namespace and authors its rich clipboard packet for that receiving instance. This covers construction, rendering and durability; real cross-instance clipboard routing is verified separately with trusted copy/paste. For a privately bundled candidate, `nativeViewModuleURL` may identify a same-origin bundle entry that only reexports the actual public `EditorView`; it must share the application build module identity and never expose a debug global or mutate editor state.
