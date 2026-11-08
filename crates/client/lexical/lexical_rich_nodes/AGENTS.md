# Lexical rich nodes

## What it is

Portable model halves of Lexical v0.45.0 rich/plain text, lists, links/autolinks, tables,
code, marks, selection, tree, offset and clipboard behavior. The optional `html`
feature exports owned HTML; browser DOM import and layout stay in views.

## Boundaries

- `mark` wraps inline runs, splits at line breaks and retains annotations only in internal clones.
- Register highlight orphan cleanup explicitly; registering CodeHighlightNode alone preserves stored orphans.
- `code` keeps stored highlights distinct and never tokenizes; new content uses plain text.
- Code factories resolve the default replacement class before setting language and theme.
- `code::line`, `code::plain` and `code::language` own line navigation, LF/tab splitting and language catalogs.
- Keep selection CSS parsing ordered and uncached; detached style inputs differ from active selected text.
- Keep descendant filtering and nearest-root insertion canonical in utils; do not shadow their re-exports.
- Use mutation-safe child cursors; collect snapshot DFS results before editing.
- `clipboard` consumes host MIME strings and HTML nodes; enable `html` for selection HTML export.

- Depends on model, regex, URL, ordered maps, language tables and tracing facades; no I/O or runtime.
- Keep this client crate excluded from workspace-hack.
- Omit the synthetic tbody for empty tables and preserve linkedom anchor href decoding.
- Emit temporary table-cell wire keys until enclosing table export removes them.
- Keep block-only registration separate from opt-in transforms and plugins.
- Keep physical grid coordinates separate from span coordinates; the physical column count comes from the last row.
- Keep DOM geometry behind TableView and apply returned observer effects in the host.
- Table span reads retain map-time writable identity; frozen cells use captured fields, live cells read current fields.
- Use selection slots in hooks; detached selections must not read the active range.
- Keep nullable/absent list wire values in ListNode so projected setters replace the same canonical fields.
- Import stored ListNode JSON without resolving replacements; authored list creation still applies replacements, matching upstream static-config import.
- List handlers read through ListNode/ListItemNode ancestry so application subclasses inherit restructuring and intrinsic transforms.
- Route host Enter through `list::register::handle_registered_insert_paragraph` before the rich-text fallback; it consumes registered numbering options.
- Use `text::entity` for every text entity; `text_entity` only re-exports it.
- Register LinkNode before AutoLink; autolink changes are transactional `AUTO_LINK_CHANGED` events.
- Keep shared Match/Matcher and pinned linkify-it patterns in `utils`; regenerate the oracle corpus with the documented script.
- Legacy JS regexes match UTF-16 code units with `find_from_ucs2`.

## Checks

- `cargo test -p lexical_rich_nodes -j4`
- `cargo test -p lexical_rich_nodes --all-features -j4`
- `cargo check -p lexical_rich_nodes --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_rich_nodes --all-targets --all-features -j4 -- -D warnings`
- `cargo tree -p lexical_rich_nodes --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Tests

Port model assertions from upstream as explicit literal tests in sibling
`test.rs` files. Keep the upstream mapping and view-only exclusions in README.md.

Regenerate pinned export goldens from the repository root with
`bun crates/client/lexical/lexical_rich_nodes/tools/html-oracle.mts`;
`cargo test -p lexical_rich_nodes --all-features --test html_oracle -j4` compares them.

HTML list attributes use `start_value()` so missing, null and fractional imported starts retain JavaScript DOM coercion.
Global matcher scans retain anchors on the original input and advance empty matches
by JavaScript UTF-16 rules; reuse exec_from/find_all in portable consumers.
