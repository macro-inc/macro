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
