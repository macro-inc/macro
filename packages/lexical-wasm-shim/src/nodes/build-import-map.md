# Tag-specific DOM conversion maps

The pinned v0.45.0 LexicalNode.ts lines 365–368 accept tag-specific factories and
return the original object as a DOMConversionMap. The source file SHA-256 is
`5503cc78ad06a3ed945f9805db9224fd2610da7fb597a078c0ab899939e43530`.
The upstream body uses `as unknown as DOMConversionMap` because factories for a
specific HTML tag are contravariant with factories declared for HTMLElement.

`buildImportMap` retains the exact mapped-tag signature over actual node types
and delegates only this association to central `widenTagConversionMap`. The helper
stores the same argument in an unknown local, then uses exactly one assertion.
It does not enumerate keys, invoke getters, clone, wrap, validate or allocate.
The four public extension wildcard aliases remain a separate type-only entry;
there are nine assertion helpers and ten named upstream compatibility entries.

Ordinary TS6 controls accept the same real HTMLInputElement factory map for
Original and actual APIs and reject a string-parameter factory in both. Recursive
node outputs stay on their respective actual graphs, without Original aliases.
The runtime control checks object identity and lazy getter/callback observations.
The namespace export guard continues to report every unrelated missing export.
