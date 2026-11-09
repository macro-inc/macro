# Compatibility selections

Own JS Point, RangeSelection and NodeSelection instances over the typed native
compatibility protocol. Keep model operations in the native adapter and DOM
selection movement in the injected view callbacks.

- Keep constructors pure JS and allocate native references lazily.
- Keep captured selection identity separate for every editor, version and native selection id.
- Keep frozen published selections immutable; synchronize detached read-scope clones without granting model write authority.
- Preserve pinned v0.45 fields, cache invalidation, owner links and clone semantics.
- Keep the sole upstream declaration exception in $createPoint: upstream declares a non-null owner for an actual owner-less point. Never copy its suppression or add another assertion.
- Import runtime core and DOM operations through SelectionRuntime; never import upstream runtime code.
- Validate public exports with contract.type-test.ts against upstream declarations.

## Checks

Run the package TypeScript check and unchanged upstream selection unit oracle.
Constructor tests exercise real JS selection instances without a replacement model.
Native acceptance requires the actual injected bridge; source-model evidence is separate.
