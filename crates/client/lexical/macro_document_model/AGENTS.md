# Macro document model

## What it is

Portable Macro node payloads, model hooks and exact export/headless/web registries.
Markdown transformers and routes are separate work packages.

## Boundaries

- Keep all 41 concrete nodes typed, with own fields in upstream exportJSON order.
- Keep named and full registration on the one source-ordered catalog in editor.rs.
- Preserve caller object order in standalone JSON-to-markdown wire helpers.
- Use ImportPolicy as the single state/base import mechanism; reproduce upstream loss.
- Preserve the Export registry without code/list replacements; Headless applies both.
- Inject NodeClock, NodeRandom and NodeHost through editor extension state; perform no I/O.
- Keep node IDs and document IDs verbatim; validated ID crates do not rewrite wire values.
- Keep browser DOM import, decoration, component caches and runtime plugins in views.
- Keep block-decorator alignment out of JSON and reset it through constructor clone hooks.
- Preserve arbitrary taskListView object keys rather than narrowing its state parser.
- Keep this client crate excluded from workspace-hack.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p macro_document_model -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance --test replay -j4 -- upstream::lexical-core`; the full source corpus is acceptance, and synthetic JSON oracles supplement it.
- `TMPDIR=/home/wolf/tmp cargo check -p macro_document_model --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p macro_document_model --all-targets -j4 -- -D warnings`
- `bun packages/lexical-conformance/corpus/synthetic.ts` regenerates fixed JSON oracles.
- `cargo x deps --check`, `cargo shear`, `just check`
