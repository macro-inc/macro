# Macro document model

## What it is

Portable Macro node payloads, model hooks and exact export/headless/web registries.
Server prompt/reply composers live in crates/macro_document_composers.
The transformer layer uses the shared lexical_markdown engine; route adapters are separate.

- Sync gate adapters supply explicit clock/entropy through is_comment_only_root_change_with_context so constructor defaults preserve service behavior without ambient host calls.

## Boundaries

- Emit document-version errors from the actual Root transform, including indirect root promotion; plain snapshot installation must not synthesize that notification.

- Read document Find through the closed current-generation `group-b.document-find` query, preserving Source UTF-16 literal legacy-case matching, keyed leaf pieces and ownerless block separators; use the existing regress UCS-2 path, with no state or selection writes. Replace through the `group-b.document-replace` command (one ordinary undoable update, Source skip/once/NodeSelection rules) and read editor statistics through `group-b.document-stats`. Regenerate `document_find/replace-oracle.json` with `UPDATE_DOCUMENT_REPLACE_ORACLE=1 bunx vitest run src/lib/core/component/LexicalMarkdown/behavior-inventory/document-replace-oracle.test.ts` from apps/web; that test also checks its freshness.

- Run Code vertical navigation on generic KeyDown LOW with its immutable Up/Down eligibility; keep key-specific application stopping after generic dispatch and ordinary Core movement at Editor priority.

- Prepare vertical block stops with block_navigation from the pending tree and selection; select only actual noninline keyboard-selectable image, video, horizontalrule, database-query and document-card nodes, using fresh host edge rectangles only when the caret is inside a block.

- Read toolbar range format, link presence and ordered top-level kinds through group-b.format-facts, and plain selection text through the closed generation-checked group-b.selection-text query without clipboard export; preserve Source endpoint, shadow-root and raw list-kind rules, and leave table facts with group-b.table-facts.

- Prepare expanded link editing with the existing empty-URL toggle policy and preserve the range; match Source cancel retaining the empty link until a paired product fix changes both engines.
- Reject non-object payloads before derived struct decoding in object-only commands and queries, because Serde also accepts positional sequences. Deserialize the original JSON after shape preflight so duplicate known fields still fail derived decoding.

- Answer action dependency queries from actual registered node-kind metadata; preserve generation-before-decode and never treat registration as JavaScript availability or construction authority.

- Insert an empty scalar DatabaseQuery through group-b.database-query-insert with an object-only empty payload and the current generation; preserve shared current/previous/root-end selection fallback and keep save/discard behavior separate.

- Insert horizontal rules through the configured factory and shared list splitter; preserve detached construction without a Range and Source decorator selectNext caret restoration.

- Share table hover-delete bounds with bulk facts; obtain selected-cell paint from actual TableSelection traversal independently, preserving merged-cell closure and current selection-only updates.
- Decode group-b.format-text and group-b.format-element from canonical enum JSON strings into the existing core commands; preserve the application envelope's generation, selection and admission checks and all command priorities.

- Checkbox-to-task: `group-b.selected-checkboxes` / `group-b.selected-checkbox-count` read the range's check-list items (Source getChecked, task-list included) with title and internal Markdown; `group-b.checkbox-task-mentions` replaces still-attached items by task mentions in one update through ListItem replace, never resurrecting removed items.
- Insert typed user mentions separately after search removal and host I/O, using current selection/admission, Source constructor fallback, insert_nodes_at_selection and select_next(0, 0); do not reuse strict menu-select range admission.
- Web menu insertions (`group-b.insert-text`, `insert-group-mention`, `insert-agent-session-mention`, `insert-booking-link-mention`) follow the same rule; `group-a.snippet-insert` swaps the first `;` search for a tracked await and `group-a.snippet-resolve-source` parses with the registered surface preset.
- Insert typed dates through group-a.insert-date-mention after separate search removal; preserve raw strings and UUID presence, current selection, shared insertion, root/shadow wrapping and select_next(0, 0). Match actual Source command-entry points in selection fixtures; a virtual nonempty-container select can descend before the handler runs.
- Insert tag mentions through group-a.insert-tag-mention after search removal; an expanded range collapses forwards and prepends one space, as Source tagsPlugin does. The `#` search kind uses Source's tag trigger boundaries (open brackets/quotes before, closers/quotes after).
- Insert document mentions after file/folder host I/O through group-b.insert-document-mention using the current selection; preserve expanded-range append, injected timestamps and Agent construction, and keep captured-position entity drops separate.
- Insert a dragged item through group-b.drop-document-mention: the mention Source creates, wrapped in a new paragraph before or after the target block key (`$insertWrappedBefore/After`), then `selectEnd`; a stale generation or a detached or root target is unhandled.
- Insert agent-session and booking-link mentions after separate search removal through their dedicated decoders, group-b.insert-agent-session-mention ({id, label?, mentionUuid?}) and group-b.insert-booking-link-mention ({profileId, slug?, label?, url}, url required). Each payload is closed (unknown fields rejected) and a stale key generation is not handled. Insert with insert_nodes_at_selection at the current selection, without collapsing it or adding a space; wrap at the root and select_next(0, 0).

- Read inline-search controller caches through surface::query_editor; preserve every ordered callback (including equal payloads), Source peer import versus dirty-transform timing, and UI-only host resets.

- Compose application plugins, command decoders and bulk-query handlers in surface.rs with append-only group registration blocks; keep editor.rs registry-only presets free of surface mutations. Register Macro shortcuts through isolated post-insertion updates and the source Enter listener, preserving first-paragraph-child matching even for interior/expanded selections.
- Keep Group B registration and command adapters in plugins_group_b.rs with child modules under plugins_group_b/; preserve its public module paths and keep mod.rs files declarations-only.
- Keep keyed Database creation in plugins_group_b/database_create_actions.rs: construct through existing clock/random hosts, complete mention/card/trailing paragraph atomically, and validate private receipts against only the actual main commit; service IO and edit admission stay outside this model.
- Route application word chords through group-b.move-to-start/end with actual keyboard facts; keep the High leading-inline-decorator policy separate from the Editor rich-text fallback, and preserve handled-without-preventing browser word movement.
- Keep composer Await payloads closed objects; capture selection before construction, resolve the first attached matching placeholder before reading completion time, and preserve Source neighbor selection.
- Treat pending empty-node Await parity as a failure outcome only; do not infer matching exception timing or allocator/callback rollback.
- Keep exterior focus atomic: leave an absent last child unchanged, reuse only an actual paragraph with empty text, otherwise append a configured paragraph before selecting root end; browser focus stays in the host.
- Keep title handoff in plugins_group_b/title_handoff.rs: focus-start mirrors Source $selectDocumentStart (stopping block decorators get a NodeSelection), prepend-paragraph inserts a paragraph with an empty text node that normalizes to an element caret like Source, and remove-leading-empty-paragraph removes the key the host captured at keydown if it still exists, without revalidating, as Historic (Source microtask semantics); browser focus stays in the host.
- Keep root pinnedPropertyIds in plugins_group_b/pinned_properties.rs: Source parse yields a fresh array for any present value, so only an absent key reads as unstored; apply ordered object-only pin operations in one update and leave its export order to the existing root finalizer.


- Own unknown HTML node names in exporter errors; opaque type names borrow their snapshot.

- Keep HTML opt-in; parse template fragments with logos starts and nom lexical modes before serializing owned nodes.
- Keep the two S3 Q7 equation exceptions bound to exact source-row hashes and exact UTF-8 markup; compare Latin-1 exports directly.
- Match list DOM exports and source attribute order byte-for-byte; never emit stored HTML directly.
- Restore source own-undefined properties as null at snapshot boundaries and on container creation using the generated catalog; keep ordinary editor JSON unchanged. Apply Source's import normalization to stored values through SyncPolicy::normalize_stored over exactly stored_normalized_fields (inventory class column: computed at export, `|| undefined` on import, never imported): falsy table frozen counts/rowStriping, cell width, code language/theme and highlightType, a falsy pr-mention url (a GitHub PR URL id moves into it, as the constructor does), every classed-block attributes, and listitem checked by parent listType (cleared outside check lists, Boolean inside). The next local sync writes the normalized value, as Source's Mirror does; pass-through fields such as colWidths keep an imported null. The Source control is `apps/web/.../collaboration/storedFieldSync.test.ts`; its fixture lives in document_session/tests/testdata/source-stored-field-sync.
- Keep wire-properties.json generated from actual source node exports and shared with conformance.
- Admit service JSON through the private service_json_builder for pr/agent-session/date mentionUuid and image/video constraint nullish defaults; keep unmarked stored-slot imports and direct updates null-preserving.
- Keep all 41 supported and 2 static-render concrete nodes typed, with own fields in upstream exportJSON order.
- Preserve raw code language/theme when the parent afterCloneFrom hook restores them.
- Normalize dirty code content through the registered code-node transform, preserving Source text separators and caret restoration while leaving token painting in the view; clear format only on exact native ordinary Text payloads, retaining keys, selection format and stored highlight fields, and retain a valid native caret when Source computes an invalid negative offset.
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
- Upgrade dirty imported lists through the attached MarkdownSync checklist-controls transform; preserve exact cold imports and generic/headless registries, and qualify remote writer effects separately.
- Inject NodeClock, NodeRandom and NodeHost through editor extension state; share these continuing services with registry-only Markdown parsers and perform no I/O.
- Supply DocumentContext to headless helpers and assign durable ids in depth-first document order.
- Emit preventDefault when native Enter policy consumes a key, including primitive key routing without a view adapter.
- Escape code, highlight and strikethrough on ArrowRight at the source caret boundaries; reuse a leading adjacent space or insert one plain space while preserving other typing formats and style.
- Stage NodeId/PeerId plugin entropy, mappings and owner state transactionally; reconcile mutations through after_commit, and count only attached owners as duplicate IDs when a subtree is recreated.
- Keep clipboard identity invalidation before insertion and restore draft wrappers within the same update.
- Complete quote clipboard insertion through the shared non-dispatching insertion/typing-state helper; retain its existing handler priority and handled result.
- Count draft marks from each commit’s mutations and attachment-changing subtrees; rebuild only for full reconciles and leave unrelated marks untouched during typing.
- Keep node IDs and document IDs verbatim; validated ID crates do not rewrite wire values.
- Keep browser DOM import, decoration, component caches and runtime plugins in views.
- Check the captured DSS source ID and URL at native URL-upgrade admission. Preserve Historic and keep the mounted media component.
- Complete uploads only on attached local media matching the captured kind, source ID, URL and generation. Preserve the mounted component and tag successful completion Historic.
- Admit PR label and URL enrichment only against the captured key, generation and exact own-field identity. Preserve Source truthiness and Historic, SkipDomSelection and SkipScrollIntoView tags.
- Admit Group A menu answers only against the exact current UTF-16 search span and collapsed caret; preserve typed mention payloads and source snippet placement while rejecting stale, composing and code-block targets.
- Resolve asynchronous snippet content only for its issued generation-aware token and matching AwaitNode; preserve source extractor cache behavior, diagnostic cleanup, placeholder placement and merged history.
- Export PasteFacts and its MIME constant for file-admission facts; read paste modifiers only from ClipboardPayload.intent and never from MIME entries.
- Request the document metadata upgrade (DOCUMENT_METADATA_UPGRADE_REQUESTED) after any node-mutating commit, as Source documentMetadataPlugin's queued history-merge update; the host answers with group-b.document-metadata-upgrade, which sets the current document version when stale and otherwise supersedes the stored slot. Publish the parsed metadata through document_metadata_normalize in the load refresh before that queued upgrade. Retain the live root id and metadata across Loro history and remote reconciliation; an ordinary local commit re-emits a retained value whose stored copy was removed through Transaction::supersede_retained_root_state, inside that commit's chain.
- Reuse the canonical metadata default for missing, null and non-object inputs; parse objects and arrays afresh so default omission preserves source identity.
- Dispatch ordinary Outdent through the shared rich-text helper at Editor priority so table and plain lists use virtual list indentation, preserving source range gating and Tab default prevention.
- Route table list Tab before row growth through table::input; consume eligible list Tab regardless of nested indent handling and prevent default before list dispatch or row insertion.
- Build the CommonTlds linkifier directly from its replacement TLD list; engine idle preparation warms the same immutable matcher before paste.
- Keep block-decorator alignment out of JSON and reset it through constructor clone hooks.
- Preserve arbitrary taskListView object keys rather than narrowing its state parser.
- Keep source object order and regex metadata in transformers/catalog.json generated from TS.
- Enter transformers/nesting.rs before every nested Markdown import (details sections, HTML blockquotes), so input nested past MAX_NODE_DEPTH fails with NestingTooDeep before it can overflow the 1 MiB wasm stack.
- Register DetailsNode and DetailsSummaryNode only through register_static_render_node (Source StaticRenderNodeTypes), never in a preset; the DETAILS_* and quoted details transformers skip import where the editor lacks them and never replace (tests/details.rs).
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

- Keep decorator host actions in shared model policy: equation updates change only the expression, and user display names preserve ID keys, attached traversal and source history/selection/scroll tags. Require the actual Snapshot type for group-b.snapshot-delete and retain its shared selection-restoration helper. Keep card and horizontal-rule deletion on the shared selection-restoration helper; document mentions retain their direct Source node removal.
- Keep media render_revision nonserialized across clone/reparent; actual true setters increment with checked u64 arithmetic even for equal values, while false setters preserve it. Use media-upgrade-url for the Source type-only Historic URL update and retain native media upload freshness checks separately.

Keep source paragraph export rules comparison-only after projected children;
retain the writer draft-stripped cache fields and every persisted value.
The fixed Macro catalog supplies comparison metadata, never JavaScript constructor authority.

## Checks

- `cargo test -p macro_document_model --test projection_children -j2` checks bounded insertion work with independent full reconstruction and fresh snapshot replay; its ignored receipt runner compares ordered operations, JSON, VV and frontiers against an explicitly retained baseline.

- `cargo test -p macro_document_model --test sync_draft_comparison` checks actual source draft-strip bootstrap, comparison-only canonical exports, immutable writer bytes and incremental parent/typing behavior.

- `bun apps/web/scripts/lexical-group-b-app-blocks.ts --check` checks the Group B pasted app-link block catalog.
- `bun apps/web/scripts/lexical-group-b-themes.ts --check` checks Group B theme paste validation/migration constants and source cases.

- `cargo test -p macro_document_model -j4`
- `cargo test -p lexical_conformance --test replay -j4 -- upstream::lexical-core`; the full source corpus is acceptance, and synthetic JSON oracles supplement it.
- `cargo check -p macro_document_model --target wasm32-unknown-unknown -j4`
- `cargo clippy -p macro_document_model --all-targets -j4 -- -D warnings`
- `bun packages/lexical-conformance/diff/gate-fuzz/wasm.ts` after native gate generation checks the actual WASM gate.
- `bun packages/lexical-conformance/corpus/macro-snapshots.ts --check` checks stored snapshot source compatibility.
- `bun packages/lexical-conformance/corpus/macro-exports.ts --check` checks service export and XML source results.
- `bun packages/lexical-conformance/corpus/synthetic.ts` regenerates fixed JSON oracles.
- `bun packages/lexical-conformance/corpus/transformers.ts --check` checks source metadata.
- `bun packages/lexical-conformance/corpus/macro-markdown.ts --check` checks the supplemental source conversion oracle.
- `cargo test -p macro_document_model --features html --test html -j4` checks source route, node and fragment bytes.
- `bun packages/lexical-conformance/corpus/macro-html.ts --check` and `bun packages/lexical-conformance/corpus/html-entities.ts --check` check HTML source freshness.
- `bun packages/lexical-conformance/corpus/macro-mentions.ts --check` checks authored references.
- `cargo x deps --check`, `cargo shear`, `just check`

Stage table key layout facts only around the nested native Key dispatch; restore the previous facts before returning, including error paths.


Run cargo test -p macro_document_model --test sync_styled_cache for the stock Chromium import/attach/update oracle and real Loro peer propagation.

Emit existing ROOT state keys id then documentMetadata after unknown keys only in live profiles installing document metadata; preserve nested unknown values and keep initialization policy separate from export ordering.

Read direct-root checklist metadata through checklist_controls::collect_checklist_metadata or collect_checklist_metadata_for_list for a single target; its ordinary-row coverage excludes nested wrappers, so consumers must preserve unknown coverage rather than infer a plain row or install task-status behavior. Plan checklist controls through the pure checklist_plan API using actual task/name/calendar facts; preserve raw unsupported filter settings and keep query/FFI activation explicit.

Expose initial/on-demand checklist plans through group-b.checklist-plan using only current collected metadata and explicit typed task/name/raw Date facts; preserve whole-result unsupported coverage and do not cache facts in a query.

Read bulk table geometry through group-b.table-facts and the actual core table map; preserve ragged slots, unique cell origins and column-width presence, and keep table-resize as the sole measured baseline/revert policy.

Apply group-b.table selection-merge and selection-split through the shared table operations and clear selection after success for the touch bar. Use format-selection-merge and format-selection-split for desktop formatting so the operation retains its resulting selection. Keep clipboard completion policy separate. The border insert-row action selects the first new cell after insertion, while column insertion uses the selection returned by the shared column operation.

Use the opt-in Macro search-text sync policy only when the browser enables Markdown search text. The policy reads the typed durable ID and projects the derived field to Loro while keeping ordinary editor exports unchanged until a storage import.

Author code-highlight/LineBreak/Tab tokens only from the session's host `CodeTokenProvider` (installed once by `surface::preset_builder_with_mode_and_tokens`; none by default), split like Source: `is_loaded` (`isCodeLanguageLoaded`) on every code transform pass and `tokenize` (`$tokenize`) only for a loaded language; validate descriptors before creating nodes, splice only the Source `getDiffRange` middle with the shared caret recipe, and never tokenize in Rust. Discarded-candidate construction is an unqualified frontier (tokens.rs).

Default an unset code language to plaintext (Source Prism `$codeNodeTransform` with Macro's tokenizer default) only on view-attached rich surfaces with a session code tokenizer (the web document body installs Source's Prism tokenizer; other surfaces have none), through `register_code_highlighting`; headless editors and initial-state builds leave it unset until a local update dirties the node. As in Source `registerCodeHighlighting`, the Text and CodeHighlightNode leaf transforms rerun the code transform on a code parent (element transforms only run for intentionally dirtied elements, so typing depends on them) and turn an orphaned code-highlight into plain text. Each code node is tokenized at most once per pending update, after the language check that runs on every pass (Source `nodesCurrentlyHighlighting`, kept in the transaction's update-local slot), so same-update text changes keep stale tokens until the next update, as in Source.

Construct inserted equations before invoking the shared current/previous/root-end selection insertion primitive; preserve the display flag and the inherited inline decorator policy.

Keep GIF insertion on its explicit list-split/select-next path; preserve the lone empty paragraph caret and Source’s NodeSelection false-inserted/orphaned-upload behavior until both engines change together.

Apply Booking display-label updates to the current typed key only; reject stale generations and closed-object payload violations, and add Historic/selection/scroll tags only for truthy changed labels.

Keep checklist facts explicit/versioned and stage key-addressed plan deltas until exact output receipt exposure; preserve raw unsupported/calendar results and document row order.

Keep reader checklist settings as producer metadata and derive with the same
planner; never persist an override on access upgrade or mask canonical state.

- Classify listitem exported indent as tree depth through SyncPolicy.indent_is_tree_depth; do not duplicate that rule in keep_local_on_remote or write exported depth into raw padding.
- Peer-class `$.local` is persisted as this peer's derived bit at the next ordinary sync after the local-status update that set it (MacroSyncPolicy::local_state_update_tag = peer::LOCAL_STATUS_TAG). A remote-created chip stores the receiver's own bit, a ruled named difference (C-PEER-LOCAL-REMOTE-CREATE-01): Source keeps the writer's value.
