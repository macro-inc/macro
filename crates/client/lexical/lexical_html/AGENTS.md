# Lexical HTML export

## What it is

Portable export-only DOM builder, walker and linkedom 0.18.13 serializer.

## Boundaries

- Depend only on the portable model and scalar/parser libraries; no DOM, I/O or runtime.
- Implement each node's ExportDom next to its owning type; rich and Macro impls are feature gated.
- Apply decodeURI only for programmatic anchor href setters, preserving reserved escapes and rejecting malformed UTF-8.
- Preserve reverse attribute insertion order, in-place attribute updates and ordered CSS properties.
- Share JS CSS declaration parsing with lexical_model; raw linkedom style attributes intentionally use its simpler grammar.
- Never emit stored HTML as Raw; only parser-produced serialized fragments may use it.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p lexical_html -j4`
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_html --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_html --all-targets -j4 -- -D warnings`
- `cargo x deps --check`, `cargo shear`, `just check`
