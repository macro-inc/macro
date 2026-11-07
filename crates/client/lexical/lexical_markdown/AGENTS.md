# Lexical markdown

## What it is

Portable Lexical v0.45.0 markdown import/export engine and transformer contracts.
No I/O, DOM, clipboard or application runtime.

## Start here

- `transformer.rs`: ordered callbacks and indexes.
- `import.rs`, `import/`: block and recursive inline import.
- `export.rs`: traversal and shared format stacks.
- `matcher.rs`: reuses rich-node Match/Matcher without a second regex wrapper.

## Boundaries

- Depends inward on lexical_model and lexical_rich_nodes; remain excluded from workspace-hack.
- Keep offsets in UTF-16 and whitespace in the JavaScript set.
- Preserve transformer order, explicit NotHandled and None export semantics.
- Default list indentation is upstream 4; Macro callers explicitly pass 2.
- Shortcuts registration belongs to WP-23.

## Checks

- `cargo test -p lexical_markdown -j4`
- `cargo test -p lexical_markdown --all-features -j4`
- `cargo check -p lexical_markdown --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_markdown --all-targets --all-features -j4 -- -D warnings`
- `cargo tree -p lexical_markdown --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

## Gotchas

- Block export callbacks start fresh format stacks; text-match callbacks share them.
- Preserve original line matching after a declining element replacement.
- Core normalization removes empty text only at commit; import does not preempt it.
