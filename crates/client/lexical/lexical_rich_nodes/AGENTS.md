# Lexical rich nodes

## What it is

Portable model halves of Lexical v0.45.0 rich-text, plain-text, hashtag, overflow
and text-entity behavior. DOM events, clipboard access and layout stay in views.

## Boundaries

- Depends on `lexical_model` and the patched `regress`; no I/O or runtime.
- Keep this client crate excluded from workspace-hack.
- Keep block-only registration separate from opt-in transforms and plugins.
- Use selection slots in hooks; detached selections must not read the active range.
- Use `text::entity` for every text entity; `text_entity` only re-exports it.
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
