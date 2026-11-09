# Compat DOM layer

## Scope

Pinned Lexical 0.45.0 DOM reconciliation, events, mutation observation and DOM
selection over captured JS node instances supplied by the compat core. All
runtime model operations enter through `CompatRuntime`; production modules must
not import runtime values from upstream `lexical` or its internal modules.

## Map

- `gen-map.ts`: pinned copy-on-write keyed DOM snapshots.
- `runtime.ts`: boot-selected core namespace and active editor/read/update scopes.
- `view.ts`: lazy root binding, reconciliation and publication of DOM listeners.
- `reconciler.ts`, `reconcile-*.ts`: node creation, suffix updates, children and root pass.
- `events.ts`, `input-events.ts`, `root-events.ts`: selection, input/composition and root/document handlers.
- `selection.ts`, `dom-slot.ts`, `mutations.ts`: DOM selection, node slots and browser mutation repair.
- `selection-methods.ts`: view-owned RangeSelection applyDOMRange/modify callbacks with injected caret primitives.
- `utils.ts`, `dom-utils.ts`, `block-cursor.ts`: ported DOM/keyboard helpers.
- `*-state.ts`: shared upstream pass/event state after splitting the source modules.
- `tests/upstream-selection-runtime.ts`: authentic upstream caret/point/selection producer for focused method comparisons.
- `upstream-harness.ts`: test-only source swapping; this retains the real upstream model.
- `types.ts` and `node-types.ts`: concrete recursive editor/state/node call subsets required by the DOM adapter; traversal is non-generic internally, while public core generics remain complete.
- `internal-contract.type-test.ts`: exact DOMInternalCallSubset manifest for the oracle; product modules can only call the members declared here.
- `upstream-contract.type-test.ts`: exact expected/actual observable declaration bundles for the external CI oracle and direct checks for the DOM-only base slot.

## Boundaries

- Create no DOM and call no createDOM/decorate hook before setRootElement receives a root.
- Bind the actual supplied root; null unbinds and later roots reuse the same core/session.
- Supply a real empty-root EditorState from the core for the first full reconcile after each bind.
- Run reconcile in withReconciliation with the published read-only next state associated with its editor; captured previous-node fields retain their previous values.
- Keep root-string deltas bounded to invalidation; require an exact JS derived-cache path before freeze, and never substitute null/stale/memo writes to published raw fields. Native-finalized caches and the upstream-model DOM oracle do not establish this production obligation.
- Call publish after finalizing the next state and before core update listeners; preserve the caller update phase for mutation callbacks and enqueue only decorator callbacks.
- Clear core composition on every root change and keep its native composition field synchronized.
- Pass a caller-owned parentSpan to root binding or reconciliation when available; the view ends only its own child span.
- Keep the core's Point/RangeSelection/NodeSelection instances and command object identities.
- Keep application types bound to upstream declarations; compare DOMObservableExpected/DOMObservableActual only through the test-only whole-graph declaration oracle after strict implementation declaration emission.
- Use view-owned editor/state/node call subsets in product signatures; keep internal traversal non-generic and public core generics unchanged; never import the declaration oracle, strip private members in product types, or introduce a view-to-core package cycle.
- Resolve configured DOM hooks through injected getEditorDOMRenderConfig; the internal config consumes only createDOM/getDOMSlot/updateDOM/decorateDOM, while the public core config retains its full generic API.
- Invoke node identity/replacement, observed-mutation/decorator hooks, and mutation listeners through guarded producer callbacks when they require the full core graph; keep callbacks function-valued and preserve real node/point/caret identities.
- Keep JS node classes unchanged; getDOMSlot must return these exported DOMSlot/ElementDOMSlot classes.
- Keep the upstream MIT notice and preserve DOM structures, command payloads and platform quirks when retargeting source.
- Distinguish ported DOM over the upstream model from the actual Rust compat engine in every test report.
- Use private headless browsers and private harness ports; never reuse a running server or attach to a person's browser.

## Checks

Run from packages/lexical-wasm-view:

- `bunx tsc --noEmit --project src/compat/tsconfig.json`
- `COMPAT_BASELINE=upstream bunx vitest run --config src/compat/vitest.config.ts`
- `bunx vitest run --config src/compat/vitest.config.ts`
- `bunx playwright test --config src/compat/browser/playwright.config.ts`
- `bunx biome check src/compat`

Run `just check` and `just pr-privacy` from the repository root.

The upstream baseline excludes the three adapter-only lifecycle cases because
unchanged upstream nodes return upstream DOMSlot constructors. The port suite
adds those cases over real published upstream snapshots.

The focused tsconfig excludes the real-upstream source fixtures from production
checking. Tests resolve the installed pinned source so their internal scopes are
the same core as the public API. The package-wide check additionally requires the
generated document_session_wasm artifact used by the existing native view tests.

Set COMPAT_DOM_TEST_DIST and COMPAT_DOM_TEST_RESULTS to private directories when
validating alongside another worktree; keep the fixture ports in a private network namespace.
