# Lexical namespace surface contract

Discover every Lexical import in the production app, core nodes and view instead
of keeping a selected-name allowlist. Compare complete runtime namespaces and
ordinary emitted declaration exports with the installed pinned v0.45 packages.
Probe package namespaces with the same exact lexical-root substitution used by
the production harness. A namespace that cannot initialize is a failure, not an
empty or passing namespace. Preserve all missing, extra and mismatched names.

Do not alias missing facade exports to upstream implementations or rewrite
declarations to make a comparison pass. This guard does not replace behavioral,
full public type-shape, native initializer or performance contracts.

## Checks

Run the comparison controls and the complete contract. The complete contract
must remain RED while any facade namespace is unavailable or mismatched. Run
strict TypeScript, Biome and scoped checks for the tooling.
