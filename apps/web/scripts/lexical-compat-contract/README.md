# Lexical assertion boundary

Run `bun run check:lexical-exceptions` from `apps/web`. The web Typecheck
workflow runs the same command for web and shared-package changes.

The guard resolves the actual shim source and checks the pinned central source
hash, reviewed single-assertion helpers, their exact call sites and reexports, the
two DOM invocation forms, the separate sound runtime witness, and the
reviewed type-only extension aliases with their resolved reference inventory. Changing a
helper or its consumers requires an explicitly reviewed manifest update.

This command checks the assertion boundary only. It does not activate the
compatibility initializer or establish namespace, declaration, runtime or
performance acceptance.
