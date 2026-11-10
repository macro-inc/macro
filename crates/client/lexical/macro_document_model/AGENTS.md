# Macro document model

## What it is

Portable Macro node payloads, model hooks and exact export/headless/web registries.
Server prompt/reply composers live in crates/macro_document_composers.
The transformer layer uses the shared lexical_markdown engine; route adapters are separate.

- Sync gate adapters supply explicit clock/entropy through is_comment_only_root_change_with_context so constructor defaults preserve service behavior without ambient host calls.

## Boundaries

- Insert typed user mentions separately after search removal and host I/O, using current selection/admission, Source constructor fallback, insert_nodes_at_selection and select_next(0, 0); do not reuse strict menu-select range admission.

- Read inline-search controller caches through surface::query_editor; preserve every ordered callback (including equal payloads), Source peer import versus dirty-transform timing, and UI-only host resets.

- Compose application plugins, command decoders and bulk-query handlers in surface.rs with append-only group registration blocks; keep editor.rs registry-only presets free of surface mutations. Register Macro shortcuts through isolated post-insertion updates and the source Enter listener, preserving first-paragraph-child matching even for interior/expanded selections.
- Keep Group B registration and command adapters in plugins_group_b.rs with child modules under plugins_group_b/; preserve its public module paths and keep mod.rs files declarations-only.
- Keep exterior focus atomic: leave an absent last child unchanged, reuse only an actual paragraph with empty text, otherwise append a configured paragraph before selecting root end; browser focus stays in the host.


- Own unknown HTML node names in exporter errors; opaque type names borrow their snapshot.

- Keep HTML opt-in; parse template fragments with logos starts and nom lexical modes before serializing owned nodes.
- Keep the two S3 Q7 equation exceptions bound to exact source-row hashes and exact UTF-8 markup; compare Latin-1 exports directly.
- Match list DOM exports and source attribute order byte-for-byte; never emit stored HTML directly.
- Restore source own-undefined properties as null at snapshot and live sync storage boundaries using the generated catalog; keep ordinary editor JSON unchanged.
- Keep wire-properties.json generated from actual source node exports and shared with conformance.
- Keep all 41 concrete nodes typed, with own fields in upstream exportJSON order.
- Preserve raw code language/theme when the parent afterCloneFrom hook restores them.
- Keep named and full registration on the one source-ordered catalog in editor.rs.
- Preserve caller object order in standalone JSON-to-markdown wire helpers.
- Validate activity envelopes separately from lenient stored-node imports; keep unknown card objects.
- Parse notification attributes in source order and unescape embedded internal link payloads.
- Share URL matching and preview/search/embedding projections through links.rs and parsers.rs.
- Keep permission gate imports fail-closed; bind each approved source divergence to its full oracle row, exact native error and captured source parse-error messages, and reject stale entries.
- Custom-code import applies peer/id setters in source order; later imports consult editor-local learned state configs.
- Keep saved download JSON separate from live sync JSON: regenerate top-level searchText before lifting draft comment wrappers and stripping completion, inline-search and custom-code children.
- Preserve immutable export reads and shallow JSON order; see [EXPORTS.md](EXPORTS.md) for the S1 Q8 acceptance boundary.
- Build reader-oriented XML through xml.rs without importing or normalizing stored node payloads.
- Use ImportPolicy as the single state/base import mechanism; reproduce upstream loss.
- Preserve the Export registry without code/list replacements; Headless applies both.
- Inject NodeClock, NodeRandom and NodeHost through editor extension state; share these continuing services with registry-only Markdown parsers and perform no I/O.
- Supply DocumentContext to headless helpers and assign durable ids in depth-first document order.
- Emit preventDefault when native Enter policy consumes a key, including primitive key routing without a view adapter.
- Escape code, highlight and strikethrough on ArrowRight at the source caret boundaries; reuse a leading adjacent space or insert one plain space while preserving other typing formats and style.
- Stage NodeId/PeerId plugin entropy, mappings and owner state transactionally; reconcile mutations through after_commit, and count only attached owners as duplicate IDs when a subtree is recreated.
- Keep clipboard identity invalidation before insertion and restore draft wrappers within the same update.
- Count draft marks from each commit’s mutations and attachment-changing subtrees; rebuild only for full reconciles and leave unrelated marks untouched during typing.
- Keep node IDs and document IDs verbatim; validated ID crates do not rewrite wire values.
- Keep browser DOM import, decoration, component caches and runtime plugins in views.
- Admit Group A menu answers only against the exact current UTF-16 search span and collapsed caret; preserve typed mention payloads and source snippet placement while rejecting stale, composing and code-block targets.
- Resolve asynchronous snippet content only for its issued generation-aware token and matching AwaitNode; preserve source extractor cache behavior, diagnostic cleanup, placeholder placement and merged history.
- Export PasteFacts and its MIME constant for file-admission facts; read paste modifiers only from ClipboardPayload.intent and never from MIME entries.
- Canonicalize hydrated document metadata through typed reads without state writes; upgrade its version only in the first ordinary local update.
- Dispatch ordinary Outdent through the shared rich-text helper at Editor priority so table and plain lists use virtual list indentation, preserving source range gating and Tab default prevention.
- Route table list Tab before row growth through table::input; consume eligible list Tab regardless of nested indent handling and prevent default before list dispatch or row insertion.
- Build the CommonTlds linkifier directly from its replacement TLD list; engine idle preparation warms the same immutable matcher before paste.
- Keep block-decorator alignment out of JSON and reset it through constructor clone hooks.
- Preserve arbitrary taskListView object keys rather than narrowing its state parser.
- Keep source object order and regex metadata in transformers/catalog.json generated from TS.
- Match transformer constructor arguments independently of static JSON import policy.
- Supply external document-link hostnames through MacroMarkdownOptions and retain typed package errors.
- Keep this client crate excluded from workspace-hack.

Canonicalize only top-level null unset table options, tablecell width, listitem
checked, code/custom-code language and theme, code-highlight highlightType,
PR mention url and classed-block attributes
in the sync policy, matching source exportJSON. Preserve backgroundColor:null,
nested array nulls, unknown nulls and every nonnull value; never erase the underlying
Loro fields. Admit literal null own text only for Await through SyncPolicy;
keep the value in both editor JSON and Loro, and reject malformed text everywhere else.

- Keep decorator host actions in shared model policy: equation updates change only the expression, and user display names preserve ID keys, attached traversal and source history/selection/scroll tags. Route decorator deletion through the shared sibling/parent selection-restoration helper.
- Keep media render_revision nonserialized across clone/reparent; actual true setters increment with checked u64 arithmetic even for equal values, while false setters preserve it. Use media-upgrade-url for the Source type-only Historic URL update and retain native media upload freshness checks separately.

Keep source paragraph export rules comparison-only after projected children;
retain the writer draft-stripped cache fields and every persisted value.
The fixed Macro catalog supplies comparison metadata, never JavaScript constructor authority.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p macro_document_model --test projection_children -j2` checks bounded insertion work with independent full reconstruction and fresh snapshot replay; its ignored receipt runner compares ordered operations, JSON, VV and frontiers against an explicitly retained baseline.

- `cargo test -p macro_document_model --test sync_draft_comparison` checks actual source draft-strip bootstrap, comparison-only canonical exports, immutable writer bytes and incremental parent/typing behavior.

- `bun apps/web/scripts/lexical-group-b-app-blocks.ts --check` checks the Group B pasted app-link block catalog.
- `bun apps/web/scripts/lexical-group-b-themes.ts --check` checks Group B theme paste validation/migration constants and source cases.

- `TMPDIR=/home/wolf/tmp cargo test -p macro_document_model -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance --test replay -j4 -- upstream::lexical-core`; the full source corpus is acceptance, and synthetic JSON oracles supplement it.
- `TMPDIR=/home/wolf/tmp cargo check -p macro_document_model --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p macro_document_model --all-targets -j4 -- -D warnings`
- `TMPDIR=/home/wolf/tmp bun packages/lexical-conformance/diff/gate-fuzz/wasm.ts` after native gate generation checks the actual WASM gate.
- `bun packages/lexical-conformance/corpus/macro-snapshots.ts --check` checks stored snapshot source compatibility.
- `bun packages/lexical-conformance/corpus/macro-exports.ts --check` checks service export and XML source results.
- `bun packages/lexical-conformance/corpus/synthetic.ts` regenerates fixed JSON oracles.
- `bun packages/lexical-conformance/corpus/transformers.ts --check` checks source metadata.
- `bun packages/lexical-conformance/corpus/macro-markdown.ts --check` checks the supplemental source conversion oracle.
- `TMPDIR=/home/wolf/tmp cargo test -p macro_document_model --features html --test html -j4` checks source route, node and fragment bytes.
- `bun packages/lexical-conformance/corpus/macro-html.ts --check` and `bun packages/lexical-conformance/corpus/html-entities.ts --check` check HTML source freshness.
- `bun packages/lexical-conformance/corpus/macro-mentions.ts --check` checks authored references.
- `cargo x deps --check`, `cargo shear`, `just check`

Stage table key layout facts only around the nested native Key dispatch; restore the previous facts before returning, including error paths.


Run cargo test -p macro_document_model --test sync_styled_cache for the stock Chromium import/attach/update oracle and real Loro peer propagation.

Emit existing ROOT state keys id then documentMetadata after unknown keys only in live profiles installing document metadata; preserve nested unknown values and keep initialization policy separate from export ordering.

Read direct-root checklist metadata through checklist_controls::collect_checklist_metadata or collect_checklist_metadata_for_list for a single target; its ordinary-row coverage excludes nested wrappers, so consumers must preserve unknown coverage rather than infer a plain row or install task-status behavior. Plan checklist controls through the pure checklist_plan API using actual task/name/calendar facts; preserve raw unsupported filter settings and keep query/FFI activation explicit.

Expose initial/on-demand checklist plans through group-b.checklist-plan using only current collected metadata and explicit typed task/name/raw Date facts; preserve whole-result unsupported coverage and do not cache facts in a query.

Read bulk table geometry through group-b.table-facts and the actual core table map; preserve ragged slots, unique cell origins and column-width presence, and keep table-resize as the sole measured baseline/revert policy.

Apply group-b.table selection-merge and selection-split to the admitted current selection through the shared table operations, then clear selection only after success; keep clipboard completion policy separate.
