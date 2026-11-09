# Compatibility selections

Own JS Point, RangeSelection and NodeSelection instances over the typed native
compatibility protocol. Keep model operations in the native adapter and DOM
selection movement in the injected view callbacks.

- Keep constructors pure JS and allocate native references lazily.
- Inject the unchanged table package's context-free factory and guard; never import its runtime into the core.
- Keep captured selection identity separate for every editor, version and native selection id.
- Keep frozen published selections immutable; synchronize detached read-scope clones without granting model write authority.
- Select the graph with getActiveStateVersion, independently from the leased raw selection reference's origin version.
- Preserve pinned v0.45 fields, cache invalidation, owner links and clone semantics.
- Keep the sole upstream declaration exception in $createPoint: upstream declares a non-null owner for an actual owner-less point. Never copy its suppression or add another assertion.
- Import runtime core and DOM operations through SelectionRuntime; never import upstream runtime code.
- Validate public exports with contract.type-test.ts against upstream declarations.

## Checks

Run the package TypeScript check and unchanged upstream selection unit oracle.
Constructor tests exercise real JS selection instances without a replacement model.
Native acceptance requires the actual injected bridge; source-model evidence is separate.

Run the unchanged 65-case oracle with `LEXICAL_SELECTION_UPSTREAM_ROOT=/path/to/pinned/source bun src/selection/tests/run-oracle.ts` from the package. It preserves the original unit configuration, pins all four spec hashes and requires exactly 65 passing assertions. Results default to the temporary directory under lexical-selection-oracle.

Set `LEXICAL_SELECTION_ENGINE=actual-native` and `LEXICAL_SELECTION_NATIVE_CONFIG=/path/to/real/core-mapper.config.mts` to use the real bridge's complete original-unit configuration. Missing native configuration fails before collection; it never falls back to the source model. The mapper must retain the original unit project, setup and aliases. A candidate native run still needs independent engine-identity validation and does not establish the full native gate.
