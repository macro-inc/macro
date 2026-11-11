# Portable HTML export

The owned builder and serializer target linkedom 0.18.13 text/html, including
reverse attribute insertion order, unescaped attribute ampersands, ordered style
maps, empty boolean attributes, case-preserving names and void elements.
Selection and HTML share one ordered JavaScript CSS declaration parser in the
model; raw style attributes retain linkedom's simpler parsing behavior.

Export-only: browser DOM import remains in the view. Raw nodes are reserved for
markup already processed by the later HTML fragment parser, never stored HTML.
The default theme is the empty headless theme. See AGENTS.md for checks.

Core and rich exporters share `HtmlExporter`, an exact-type registry, optional
host overrides and render hooks. Partial text selections use ephemeral cloned
records, preserving clone hooks and the original snapshot. UTF-16 boundaries
inside a surrogate pair render U+FFFD while editing continues to reject them.

Regenerate serializer goldens with
`bun crates/client/lexical/lexical_html/tools/serializer-oracle.mts`. The serializer
also preserves linkedom’s unusual nonempty void elements: an explicitly inserted
child causes a closing tag, while empty void elements render `<br>`.
