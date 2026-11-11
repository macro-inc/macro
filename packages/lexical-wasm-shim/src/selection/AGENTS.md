# Compatibility selections

Own JS Point, RangeSelection and NodeSelection instances over the typed native
compatibility protocol. Keep model operations in the native adapter and DOM
selection movement in the injected view callbacks.

- Keep constructors pure JS; buffer selection intent without references and allocate real native references only at explicit semantic write barriers.
- Pass node arguments as deferred actual-node groups; encode captured/reserved authority only at semantic barriers, never fabricate native references or snapshot unacknowledged cached nodes.
- Declare injected capability callbacks as function-valued properties to preserve strict parameter variance.
- Bind the same JS selection instance before decoding barrier snapshots; never fabricate empty replies or sentinel references.
- Capture the live active JS selection before publication as well as at write barriers, because raw field writes can bypass bufferSelection.
- Read selection nodes, text and direction from the acknowledged JS graph with injected caret algorithms; never allocate references or invoke native queries from getters.
- Inject the unchanged table package's context-free factory and guard; never import its runtime into the core.
- Keep captured selection identity separate for every editor, version and native selection id.
- Keep frozen published selections immutable; synchronize detached read-scope clones without granting model write authority.
- Select the graph with getActiveStateVersion, independently from the leased raw selection reference's origin version.
- Preserve pinned v0.45 fields, cache invalidation, owner links and clone semantics.
- Delegate $createPoint to compatibility-exceptions.createPointWithUpstreamType; keep the owner-less upstream declaration gap in that centralized adapter without adding local assertions.
- Keep RawTableSelectionValue transport-only and separate from public BaseSelection conformance until the table package is typed against the actual core.
- Import runtime core and DOM operations through SelectionRuntime; never import upstream runtime code.
- Export exact SelectionObservableExpected/SelectionObservableActual bundles for the strict emitted-declaration oracle; keep only the safe owner-gap assertions direct in contract.type-test.ts.

## Checks

Run the package TypeScript check and unchanged upstream selection unit oracle.
Constructor tests exercise real JS selection instances without a replacement model. Read tests exercise the same pure ordering, caret traversal, text extraction and intent-transition algorithms with real upstream nodes, carets and state; keep each producer in its own node type graph. These tests retain every source case but do not establish actual-wrapper caching or native zero-crossing acceptance; that requires the real acknowledged-mirror bridge.
Native acceptance requires the actual injected bridge; source-model evidence is separate.

Run the unchanged 65-case oracle with `LEXICAL_SELECTION_UPSTREAM_ROOT=/path/to/pinned/source bun src/selection/tests/run-oracle.ts` from the package. It preserves the original unit configuration, pins all four spec hashes and requires exactly 65 passing assertions. Results default to the temporary directory under lexical-selection-oracle.

Set `LEXICAL_SELECTION_ENGINE=actual-native` and `LEXICAL_SELECTION_NATIVE_CONFIG=/path/to/real/core-mapper.config.mts` to use the real bridge's complete original-unit configuration. Missing native configuration fails before collection; it never falls back to the source model. The mapper must retain the original unit project, setup and aliases. A candidate native run still needs independent engine-identity validation and does not establish the full native gate.
