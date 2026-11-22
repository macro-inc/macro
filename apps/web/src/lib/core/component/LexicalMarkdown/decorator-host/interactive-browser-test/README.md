# Interactive decorator Source controls

The Snapshot and Paste cases mount the actual registered Source components over
an actual markdown-sync wrapper, rich text, selection data, document metadata
and trailing-paragraph plugins. Every node receives a deterministic durable ID.
The supplied cached preview is explicitly denied; this fixture does not prove
backend permission or navigation. It captures literal model JSON and DOM before
and after real NodeSelection, separately for each browser engine.

Capture before changing a component, then compare every initial and selected
attachment byte-for-byte after extraction. Never normalize IDs, metadata, style
attributes or attribute order. Run against verified pristine dependencies and a
fresh owned Vite process/cache. The fixture has no native artifact dependency.

Snapshot's narrow host preserves the Source editor capture point, Normal Enter
registration/cleanup, selection membership and Snapshot-only removal predicate.
An absent Source editor legitimately produces no Enter registration. A supplied
native provider without Snapshot capabilities fails explicitly. Native Snapshot
binding, typed removal and application navigation acceptance remain separate.

The Normal Enter timing control registers an actual earlier listener before the
component mounts. It changes pending selection to a range while the component
still reads its published NodeSelection, consumes Enter and skips a later
listener. Original and hosted components must return the same trace. Pending
native queries are a separate API; do not replace this component cache with them.
