# Macro document model

## What it is

Portable Macro node payloads, model hooks and exact export/headless/web registries.
The transformer layer uses the shared lexical_markdown engine; route adapters are separate.

## Boundaries

- Keep all 41 concrete nodes typed, with own fields in upstream exportJSON order.
- Preserve raw code language/theme when the parent afterCloneFrom hook restores them.
- Keep named and full registration on the one source-ordered catalog in editor.rs.
- Preserve caller object order in standalone JSON-to-markdown wire helpers.
- Validate activity envelopes separately from lenient stored-node imports; keep unknown card objects.
- Parse notification attributes in source order and unescape embedded internal link payloads.
- Share URL matching and preview/search/embedding projections through links.rs and parsers.rs.
- Build reader-oriented XML through xml.rs without importing or normalizing stored node payloads.
- Use ImportPolicy as the single state/base import mechanism; reproduce upstream loss.
- Preserve the Export registry without code/list replacements; Headless applies both.
- Inject NodeClock, NodeRandom and NodeHost through editor extension state; perform no I/O.
- Supply DocumentContext to headless helpers and assign durable ids in depth-first document order.
- Stage NodeId/PeerId plugin entropy, mappings and owner state transactionally; reconcile mutations through after_commit.
- Keep clipboard identity invalidation before insertion and restore draft wrappers within the same update.
- Keep node IDs and document IDs verbatim; validated ID crates do not rewrite wire values.
- Keep browser DOM import, decoration, component caches and runtime plugins in views.
- Keep block-decorator alignment out of JSON and reset it through constructor clone hooks.
- Preserve arbitrary taskListView object keys rather than narrowing its state parser.
- Keep source object order and regex metadata in transformers/catalog.json generated from TS.
- Match transformer constructor arguments independently of static JSON import policy.
- Supply external document-link hostnames through MacroMarkdownOptions and retain typed package errors.
- Keep this client crate excluded from workspace-hack.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p macro_document_model -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance --test replay -j4 -- upstream::lexical-core`; the full source corpus is acceptance, and synthetic JSON oracles supplement it.
- `TMPDIR=/home/wolf/tmp cargo check -p macro_document_model --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p macro_document_model --all-targets -j4 -- -D warnings`
- `bun packages/lexical-conformance/corpus/synthetic.ts` regenerates fixed JSON oracles.
- `bun packages/lexical-conformance/corpus/transformers.ts --check` checks source metadata.
- `bun packages/lexical-conformance/corpus/macro-markdown.ts --check` checks the supplemental source conversion oracle.
- `cargo x deps --check`, `cargo shear`, `just check`
