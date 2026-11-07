# Lexical rich nodes

Model halves of Lexical v0.45.0, layered on `lexical_model`. Node payloads hold
only their own serialized fields; the core owns tree links, element/text data,
selection and update processing. This crate has no I/O, browser, or server runtime.

`register_rich_text_nodes` registers HeadingNode and QuoteNode. OverflowNode has
an intrinsic transform that removes empty wrappers and delegates new-block
insertion to its parent. Register it explicitly when needed.

The literal tests in `heading/test.rs` and `quote/test.rs` port upstream
LexicalHeadingNode and LexicalQuoteNode model tests, including empty/middle/end
insertion, level changes and collapse-at-start behavior. DOM construction,
updates, import rules and rendered HTML assertions belong to the view or HTML
port. `overflow/test.rs` covers its intrinsic transform and parent delegation;
upstream has no standalone overflow unit suite.

The upstream algorithms and pattern data are MIT-licensed; see LICENSE-LEXICAL.
See AGENTS.md for validation commands and module boundaries.

Hashtag uses the single generic implementation in `text::entity` (also
re-exported as `text_entity`). `TextEntityBuilderExt::text_entity` registers exact
plain-text and entity-type transforms. Entity replacement copies format only;
style, detail and NodeState are intentionally dropped as upstream does.

`hashtag/pattern.txt` is the evaluated pattern from upstream
`LexicalHashtagExtension.ts` at v0.45.0, with non-ASCII code units escaped as
`\uNNNN`. It preserves `String.fromCharCode` truncation of three CJK ranges.
The patched regress matcher runs without `u`, using `find_from_ucs2`; decoding
surrogate pairs with `find_from_utf16` would change legacy JavaScript boundaries.
`hashtag/test.rs` ports the upstream serialized shape and adds literal UTF-16
matcher checks. `text/entity/test.rs` exercises transform split/extension,
mode guards, reversal and property-copy behavior; upstream has no standalone
text-entity unit suite.

`rich_text` exposes the model command functions; the view owns keyboard event
routing, host movement targets, clipboard reads, platform/language checks and
preventDefault. `plain_text` keeps its range-only guards and inserts a line break
for Enter. `tab` and `utils` share block indentation instead of implementing a
second path. A supplied maximum is exclusive; zero is unlimited.

Escape-format config retains entry order. Trigger fields are `Option<bool>`:
omitted fields preserve existing values during shallow merge, while `Some(false)`
explicitly disables one trigger. This retains upstream JavaScript's distinction
between an absent property and false, which a plain boolean struct cannot express.
The format entry itself is `None` to disable that format completely.

Literal test ports include EscapeFormatTriggers (boundary, shift, capitalization,
merge/null and runtime config cases), LexicalTabNode (both insertion/typing cases),
RichTextNodeSelectionEnter (block/inline decorators), and both
RichTextInlineDecoratorMoveToStart/End suites (including no-op/safety cases).
Additional explicit tests cover rich/plain command return values, host-resolved
deletion, indentation limits, selection slots and UTF-16 drop positions.

`register_hashtag` installs a per-editor `HashtagConfig`; its matcher can be
replaced transactionally without affecting another editor. `normalize_triple_click`
registers a critical before-listener for selection changes and consumes the host's
triple-click fact. `click_after_last_block` registers a typed application command
and re-reads the root's last child before testing the configured predicate. Omit
registration to disable either plugin. Mouse timing, geometry, read-only click
claiming and preventDefault remain view responsibilities.

The plugin tests cover triple/ordinary/disabled selection changes and the model
cases from ClickAfterLastBlock.test.ts: block decorator, rejected predicate,
disabled registration and empty root. Shadow-root and stale-last-child cases are
additional literal checks. Its read-only test is a DOM claim test and remains in
the view. RichTextImportExtension tests are DOM import tests, outside this model
package. The heading test involving an empty ListItem inside ListNode belongs to
the list-node port; this package covers all its non-list heading/quote cases.
Tier A rich-text/plain-text/hashtag fixture replay is a later conformance layer;
these unit ports run directly against the model without a fixture replay DSL.


`list` implements ListNode/ListItemNode, intrinsic numbering/merge/orphan repair,
list conversion/removal, structural indent/outdent, empty-item Enter, optional
strict indentation, marker style synchronization and checklist navigation. The
five package command keys dispatch at Low priority. Host Enter routing calls
`handle_registered_insert_paragraph` before rich-text insertion, so the registered
numbering option is consumed without introducing a duplicate stock-command key.
Numbering is signed 32-bit as specified for stored list values; command start
payloads use the same integer contract rather than the later JsNumber sketch.

The literal list tests port model assertions from LexicalListNode,
LexicalListItemNode, formatList and utils suites, and cover strict-indent and
checklist model branches. They include S4 R2-35's nested collapse (content is
intentionally dropped), orphan grouping/lifting, element-point remapping,
subclass dispatch, check-state reset/copy, numbering and every package command.
DOM classes, HTML import/export, focus/hit testing and fractional JS indent input
remain view/HTML concerns or use the core's typed unsigned indent boundary.
The replayer now runs all eleven recorded rich-text, one hashtag and both list
fixtures; there are no recorded plain-text fixtures. JS return objects with an
undefined checked property retain that marker in the replayer, while model JSON
correctly omits it from serialized snapshots.

`table::nodes` ports TableNode, TableRowNode and TableCellNode payloads, shadow-root
flags and JSON coercions. `table::map` preserves ragged rows, holes, truncated
bottom overflow, rectangle expansion and map-time writable identity. Table row
height null is intentionally imported as absent; negative/fractional imported
spans are rejected by the typed payload. DOM creation and HTML conversion belong
to the view/HTML layers.

`table::ops` ports dimension creation, logical/deprecated physical row and
column edits, merging, unmerging and simple-table column moves. Repeated span
writes intentionally follow upstream live-cell identity. `table::grid` derives
physical coordinates and span geometry from model snapshots; host elements and
highlight state remain outside the model.

`register_table` installs table selection hooks and integrity transforms, with
optional cell-unmerge and background-removal policies. Table selections retain
upstream row-major, reverse-descendant traversal and detached-range formatting.
Observer actions return model outcomes to the view. The four application
clear-text tests preserve one childless paragraph per cleared cell before
normalization, including a key-allocation guard against an empty text child.

`table::commands` implements insertion, select-all, triple-click and table paste.
Clipboard tables unmerge/grow/fill the destination using upstream's captured
intermediate maps. Shared caret-based root insertion also serves list lifting.
`table::handlers` returns event-claiming and observer effects; `TableView` supplies
only typeahead, cell-element presence and visual caret-edge facts. Clipboard I/O,
pointer lifecycle, highlights and event cancellation remain in the host.
Literal tests cover caret navigation, merged rectangles, edge paragraphs, Tab,
cut/deletion, formatting, crossing ranges and touch/Firefox selection correction.
