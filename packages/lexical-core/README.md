# Lexical Core

Shared Lexical nodes, Markdown transformers, and utilities for web editors,
static message rendering, and backend document conversion. Keep this package
independent of web components and browser-only imports; runtime-neutral libraries
such as `linkify-it` supply shared parsing behavior.

## Links

All Markdown import formats recognize bare URLs, common bare domains, email
addresses, and angle-bracket URLs with the shared matcher in
`utils/auto-link.ts`. URL matching runs during inline parsing so formatting
characters inside a URL remain literal. Code, existing links, mention payloads,
and escaped URL text retain their own syntax. Existing bare URLs become clickable
when imported; their source Markdown is not rewritten in storage.

The editor and parser share URL validation and normalization. Preserve existing
percent escapes, use the HTTP/HTTPS/mailto allowlist, and continue past rejected
matches to find later valid links.

Internal Markdown persists an explicit removal as
`<m-link>{"url":"https://example.com","text":"https://example.com","title":"","unlinked":true,"format":0}</m-link>`.
The optional `unlinked` field imports as the existing `UnlinkedTextNode`; `format`
preserves its text formatting. Older clients ignore these fields and render a
normal link using the normalized URL. Removed labels that contain no URL export
as ordinary formatted text. Ordinary link payloads are unchanged. External Markdown exports
removed links as escaped literal text.

Before this marker existed, removed links could be saved as plain URL text or as
ordinary link payloads. Their original intent cannot be recovered; legacy bare
URLs follow the automatic-linking policy.
