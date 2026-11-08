# S2 — Upstream Lexical v0.45.0 feature inventory

The checklist for the Rust port: every exported symbol of every upstream package, plus every behaviour that is not a symbol. Implementers tick `[ ]` → `[x]`. Companion to `../SCOPE.md` (crate layout §1/§2, phases §5) and the notes files.

## How to read this

**Sources.** Upstream is `target/lexical-upstream` at v0.45.0. Symbols were extracted with the TypeScript compiler API (`checker.getExportsOfModule`, aliases resolved) from every entry point in upstream `tsconfig.json` `paths`: 37 package entry points plus 54 `@lexical/react/*` subpaths and 8 `@lexical/internal/*` subpaths. `@lexical/eslint-plugin*`, `lexical-website`, `lexical-devtools` (the browser extension app) and `lexical-playground` (an app, not a library; see §4) are excluded from §2. Macro usage was re-scanned over `apps/ packages/ services/ js/` of the `wolf-rust-lexical` worktree. It matches `symbols.json` exactly: 268 symbols in 490 files. Macro imports nothing from `@lexical/react`, `yjs`, `extension`, `code-core`, `code-prism`, `code-shiki`, `hashtag`, `overflow`, `offset`, `text`, `file`, `dragon` or `devtools-core` directly.

**Columns.**
- *Kind*: `fn`, `class`, `const`, `type` (interface or alias), `command` (a `createCommand` value), `extension` (a `defineExtension` value), or `const+type`.
- *What it does*: the first sentence of upstream JSDoc, or a hand-written one-liner where there is none. `(see §B)` points into §3.
- *Class*:
  - **MODEL**: must exist in Rust (pure document or selection semantics).
  - **VIEW**: stays in the JS or native view (DOM, events, UA sniffing, React).
  - **BRIDGE**: has a Rust model part and a view part. Node classes are BRIDGE because they own both `createDOM`/`exportDOM` and the model, and so are commands whose payload is a DOM event.
- *Macro*: `yes (N files)`, `via <entry>` when Macro imports the same symbol through a re-exporting package, or `no`.
- *Target crate*: the primary home. `X + <view owner>` means the model half goes in X and the DOM half stays in the view. View owners (R2.1, S12 §4, which replaced R1's `native-view`): `web-view` (`@macro-inc/lexical-wasm-view` or a `LexicalMarkdown` view module, shipped), `shim` (`packages/lexical-wasm-shim` only), `not-needed` (upstream JS runs unchanged in Tier B; not shipped), `ios-view`/`android-view` (no export rows; native obligations are S12 §4.3 behaviours).
  - `shim-only` means the item exists only in the JS compatibility shim (`packages/lexical-wasm-shim`). These are TS-only types, the signals re-exports, and dev invariants.
  - HTML import stays JS (S12 V-4): the legacy `importDOM` path is `web-view` (`view/html-import/`); the rest of the rule-based DOM import is `not-needed` (R2.1, replacing `shim-only (JS HTML import)`).
  - `lexical_loro (reference only)` is used for `@lexical/yjs`: it is not ported; it is the design reference for the Loro binding.
- *Pri*:
  - **P0**: Macro imports the symbol directly or through a re-export.
  - **P1**: the name occurs in an upstream unit test (`packages/*/src/**/__tests__`, excluding playground and website), so the conformance shim needs it.
  - **P2**: completeness.
  - P1 is a lexical heuristic. Generic names such as `Props` or `default` can false-positive.

Re-export rows are listed under the package that re-exports them, so that the per-package export count is exact, and they say `re-export of <origin>`. Implement them once, at the origin. "Unique" totals count each symbol once.

## 1. Totals

Per package (entry-point group; `@lexical/react`, `@lexical/internal` and `@lexical/headless` subpaths folded in). Behaviour checklist items in §3: 1292 (A 412, B 303, C 229, D 348); **AMBIGUOUS** flags: 74 plus §5.

| Package | Exports | Own | Re-exported | MODEL | BRIDGE | VIEW | P0 | P1 | P2 | Imported by Macro |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `lexical` | 382 | 382 | 0 | 263 | 62 | 57 | 151 | 86 | 145 | 151 |
| `@lexical/clipboard` | 29 | 29 | 0 | 19 | 8 | 2 | 5 | 9 | 15 | 5 |
| `@lexical/code` | 28 | 1 | 27 | 23 | 4 | 1 | 9 | 3 | 16 | 9 |
| `@lexical/code-core` | 22 | 22 | 0 | 17 | 5 | 0 | 6 | 4 | 12 | 0 |
| `@lexical/code-prism` | 14 | 14 | 0 | 12 | 1 | 1 | 3 | 3 | 8 | 0 |
| `@lexical/code-shiki` | 13 | 13 | 0 | 9 | 2 | 2 | 0 | 6 | 7 | 0 |
| `@lexical/devtools-core` | 7 | 7 | 0 | 2 | 0 | 5 | 0 | 1 | 6 | 0 |
| `@lexical/dragon` | 3 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 3 | 0 |
| `@lexical/extension` | 79 | 58 | 21 | 64 | 12 | 3 | 0 | 26 | 53 | 0 |
| `@lexical/file` | 5 | 5 | 0 | 3 | 0 | 2 | 0 | 0 | 5 | 0 |
| `@lexical/hashtag` | 6 | 6 | 0 | 4 | 2 | 0 | 0 | 2 | 4 | 0 |
| `@lexical/headless` | 2 | 2 | 0 | 1 | 0 | 1 | 1 | 1 | 0 | 1 |
| `@lexical/history` | 9 | 9 | 0 | 7 | 2 | 0 | 2 | 3 | 4 | 2 |
| `@lexical/html` | 83 | 83 | 0 | 0 | 83 | 0 | 2 | 34 | 47 | 2 |
| `@lexical/link` | 27 | 27 | 0 | 19 | 5 | 3 | 7 | 8 | 12 | 7 |
| `@lexical/list` | 32 | 32 | 0 | 26 | 6 | 0 | 14 | 7 | 11 | 14 |
| `@lexical/mark` | 8 | 8 | 0 | 6 | 2 | 0 | 7 | 0 | 1 | 7 |
| `@lexical/markdown` | 30 | 30 | 0 | 30 | 0 | 0 | 15 | 2 | 13 | 15 |
| `@lexical/offset` | 3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `@lexical/overflow` | 5 | 5 | 0 | 3 | 2 | 0 | 0 | 3 | 2 | 0 |
| `@lexical/plain-text` | 2 | 2 | 0 | 0 | 2 | 0 | 1 | 1 | 0 | 1 |
| `@lexical/react` | 129 | 120 | 9 | 9 | 1 | 119 | 1 | 55 | 73 | 0 |
| `@lexical/rich-text` | 19 | 19 | 0 | 12 | 6 | 1 | 9 | 3 | 7 | 9 |
| `@lexical/selection` | 25 | 23 | 2 | 21 | 2 | 2 | 5 | 4 | 16 | 4 |
| `@lexical/table` | 71 | 71 | 0 | 56 | 8 | 7 | 33 | 8 | 30 | 33 |
| `@lexical/tailwind` | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| `@lexical/text` | 9 | 9 | 0 | 9 | 0 | 0 | 0 | 3 | 6 | 0 |
| `@lexical/utils` | 58 | 38 | 20 | 34 | 0 | 24 | 12 | 21 | 25 | 8 |
| `@lexical/yjs` | 31 | 31 | 0 | 29 | 0 | 2 | 0 | 7 | 24 | 0 |
| `@lexical/internal` | 8 | 8 | 0 | 8 | 0 | 0 | 0 | 7 | 1 | 0 |
| **Total** | **1140** | **1061** | **79** | **689** | **215** | **236** | **283** | **308** | **549** | **268** |

Unique (defining-site) symbols: **1052** — MODEL 625, BRIDGE 211, VIEW 216; P0 266, P1 271, P2 515.

Unique symbols by primary target crate (R2.1, recounted over the §2 rows): `lexical_model` 386, `lexical_rich_nodes` 242, `not-needed` 227, `web-view` 69, `shim-only` 37, `lexical_markdown` 30, `lexical_loro` 29, `lexical_html` 25, `shim` 7. (R1 had `lexical_model` 444, `native-view` 219, `lexical_rich_nodes` 200, `shim-only` 105.)

R1 correction (audit R1-B C-1/C-2): the 29 `@lexical/clipboard` and `@lexical/plain-text` symbol rows now target `lexical_rich_nodes` (S3 §1d and §1a.4b own them; no spec placed them in `lexical_model`). The per-crate counts above predate that move; the line before it is recounted in R2.1.

Unique symbols by kind: fn 483, type 290, const 117, command 66, extension 49, class 44, const+type 3.

## 2. Exported symbols, by package

### `lexical` (382 exports: 382 own, 0 re-exported; MODEL 263 / BRIDGE 62 / VIEW 57; P0 151 / P1 86 / P2 145; imported by Macro: 151)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `BaseCaret` | type | shared shape of all PointCaret variants (origin, direction, type) | MODEL | no | lexical_model | P2 |
| [ ] | `CaretDirection` | type | The direction of a caret, 'next' points towards the end of the document and 'previous' points towards the beginning | MODEL | no | lexical_model | P1 |
| [ ] | `CaretRange` | type | A RangeSelection expressed as a pair of Carets | MODEL | no | lexical_model | P1 |
| [ ] | `CaretType` | type | A sibling caret type points from a LexicalNode origin to its next or previous sibling, and a child caret type points from an ElementNode origin to its first or last child. | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `ChildCaret` | type | A ChildCaret points from an origin ElementNode towards its first or last child. | MODEL | no | lexical_model | P1 |
| [ ] | `CommonAncestorResult` | type | The result of comparing two nodes that share some common ancestor | MODEL | no | lexical_model | P2 |
| [ ] | `CommonAncestorResultAncestor` | type | Node a is an ancestor of node b, and not the same node | MODEL | no | lexical_model | P2 |
| [ ] | `CommonAncestorResultBranch` | type | Node a and node b have a common ancestor but are on different branches, the `a` and `b` properties of this result are the ancestors of a and b that are children of the commonAncestor. | MODEL | no | lexical_model | P2 |
| [ ] | `CommonAncestorResultDescendant` | type | Node a was a descendant of node b, and not the same node | MODEL | no | lexical_model | P2 |
| [ ] | `CommonAncestorResultSame` | type | The two compared nodes are the same | MODEL | no | lexical_model | P2 |
| [ ] | `FlipDirection` | type | A type utility to flip next and previous | MODEL | no | lexical_model | P2 |
| [ ] | `NodeCaret` | type | A NodeCaret is the combination of an origin node and a direction that points towards where a connected node will be fetched, inserted, or replaced. | MODEL | no | lexical_model | P1 |
| [ ] | `PointCaret` | type | A PointCaret is a NodeCaret that also includes a TextPointCaret type which refers to a specific offset of a TextNode. | MODEL | no | lexical_model | P1 |
| [ ] | `RootMode` | type | The RootMode is specified in all caret traversals where the traversal can go up towards the root. | MODEL | no | lexical_model | P2 |
| [ ] | `SiblingCaret` | type | A SiblingCaret points from an origin LexicalNode towards its next or previous sibling. | MODEL | no | lexical_model | P1 |
| [ ] | `StepwiseIteratorConfig` | type | config for makeStepwiseIterator (initial, hasNext, step, map) | MODEL | no | lexical_model | P2 |
| [ ] | `TextPointCaret` | type | A TextPointCaret is a special case of a SiblingCaret that also carries an offset used for representing partially selected TextNode at the edges of a CaretRange. | MODEL | no | lexical_model | P1 |
| [ ] | `TextPointCaretSlice` | type | A TextPointCaretSlice is a wrapper for a TextPointCaret that carries a signed distance representing the direction and amount of text selected from the given caret. | MODEL | no | lexical_model | P2 |
| [ ] | `TextPointCaretSliceTuple` | type | A utility type to specify that a CaretRange may have zero, one, or two associated TextPointCaretSlice. | MODEL | no | lexical_model | P2 |
| [ ] | `$comparePointCaretNext` | fn | A total ordering for `PointCaret<'next'>`, based on the same order that a {@link CaretRange} would iterate them. | MODEL | no | lexical_model | P1 |
| [ ] | `$extendCaretToRange` | fn | Construct a CaretRange that starts at anchor and goes to the end of the document in the anchor caret's direction. | MODEL | no | lexical_model | P1 |
| [ ] | `$getAdjacentChildCaret` | fn | Gets the adjacent caret, if not-null and if the origin of the adjacent caret is an ElementNode, then return the ChildCaret. | MODEL | no | lexical_model | P2 |
| [ ] | `$getCaretRange` | fn | Construct a CaretRange from anchor and focus carets pointing in the same direction. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$getChildCaret` | fn | Get a caret that points at the first or last child of the given origin node, which must be an ElementNode. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$getChildCaretOrSelf` | fn | Gets the ChildCaret if one is possible at this caret origin, otherwise return the caret | MODEL | no | lexical_model | P2 |
| [ ] | `$getCollapsedCaretRange` | fn | Construct a collapsed CaretRange that starts and ends at anchor. | MODEL | no | lexical_model | P1 |
| [ ] | `$getCommonAncestor` | fn | Find a common ancestor of a and b and return a detailed result object, or null if there is no common ancestor between the two nodes. | MODEL | no | lexical_model | P1 |
| [ ] | `$getCommonAncestorResultBranchOrder` | fn | Return the ordering of siblings in a {@link CommonAncestorResultBranch} | MODEL | no | lexical_model | P2 |
| [ ] | `$getSiblingCaret` | fn | Get a caret that points at the next or previous sibling of the given origin node. | MODEL | yes (2 files) | lexical_model | P0 |
| [ ] | `$getTextNodeOffset` | fn | Get a normalized offset into a TextNode given a numeric offset or a direction for which end of the string to use. | MODEL | no | lexical_model | P2 |
| [ ] | `$getTextPointCaret` | fn | Construct a TextPointCaret | MODEL | no | lexical_model | P1 |
| [ ] | `$getTextPointCaretSlice` | fn | Construct a TextPointCaretSlice given a TextPointCaret and a signed distance. | MODEL | no | lexical_model | P2 |
| [ ] | `$isChildCaret` | fn | Guard to check if the given argument is specifically a ChildCaret | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$isNodeCaret` | fn | Guard to check if the given argument is any type of caret | MODEL | no | lexical_model | P2 |
| [ ] | `$isSiblingCaret` | fn | Guard to check if the given argument is specifically a SiblingCaret (or TextPointCaret) | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$isTextPointCaret` | fn | Guard to check if the given caret is specifically a TextPointCaret | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$isTextPointCaretSlice` | fn | Guard to check for a TextPointCaretSlice | MODEL | no | lexical_model | P1 |
| [ ] | `flipDirection` | fn | Flip a direction ('next' -> 'previous'; 'previous' -> 'next'). | MODEL | no | lexical_model | P2 |
| [ ] | `makeStepwiseIterator` | fn | A generalized utility for creating a stepwise iterator based on: - an initial state - a stop guard that returns true if the iteration is over, this is typically used to detect a sentinel value such as null or undefined f | MODEL | no | lexical_model | P2 |
| [ ] | `$caretFromPoint` | fn | convert a selection Point to a PointCaret in a direction | VIEW | no | shim | P2 |
| [ ] | `$caretRangeFromSelection` | fn | Get a pair of carets for a RangeSelection. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$getAdjacentSiblingOrParentSiblingCaret` | fn | Returns the Node sibling when this exists, otherwise the closest parent sibling. | MODEL | no | lexical_model | P2 |
| [ ] | `$getCaretInDirection` | fn | Return the caret if it's in the given direction, otherwise return caret.getFlipped(). | MODEL | no | lexical_model | P1 |
| [ ] | `$getCaretRangeInDirection` | fn | Return the range if it's in the given direction, otherwise construct a new range using a flipped focus as the anchor and a flipped anchor as the focus. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$getChildCaretAtIndex` | fn | Get a caret pointing at the child at the given index, or the last caret in that node if out of bounds. | MODEL | no | lexical_model | P2 |
| [ ] | `$isExtendableTextPointCaret` | fn | Determine whether the TextPointCaret's offset can be extended further without leaving the TextNode. | MODEL | no | lexical_model | P2 |
| [ ] | `$normalizeCaret` | fn | Normalize a caret to the deepest equivalent PointCaret. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$removeTextFromCaretRange` | fn | Remove all text and nodes in the given range. | MODEL | no | lexical_model | P1 |
| [ ] | `$rewindSiblingCaret` | fn | Given a SiblingCaret we can always compute a caret that points to the origin of that caret in the same direction. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$setPointFromCaret` | fn | Update the given point in-place from the PointCaret | MODEL | no | lexical_model | P1 |
| [ ] | `$setSelectionFromCaretRange` | fn | Set a RangeSelection on the editor from the given CaretRange | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$splitAtPointCaretNext` | fn | Split a node at a PointCaret and return a NodeCaret at that point, or null if the node can't be split. | MODEL | no | lexical_model | P1 |
| [ ] | `$updateRangeSelectionFromCaretRange` | fn | Update the points of a RangeSelection based on the given PointCaret. | MODEL | no | lexical_model | P2 |
| [ ] | `SplitAtPointCaretNextOptions` | type | options for $splitAtPointCaretNext ($copyElement, $splitTextPointCaretNext, rootMode) | MODEL | no | lexical_model | P1 |
| [ ] | `BEFORE_INPUT_COMMAND` | command | command: before input | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `BLUR_COMMAND` | command | command: blur | BRIDGE | yes (3 files) | lexical_model + web-view | P0 |
| [ ] | `CAN_REDO_COMMAND` | command | command: can redo | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `CAN_UNDO_COMMAND` | command | command: can undo | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `CLEAR_EDITOR_COMMAND` | command | command: clear editor | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `CLEAR_HISTORY_COMMAND` | command | command: clear history | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `CLICK_COMMAND` | command | command: click | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `COMPOSITION_END_COMMAND` | command | command: composition end | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `COMPOSITION_START_COMMAND` | command | command: composition start | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `CONTROLLED_TEXT_INSERTION_COMMAND` | command | command: controlled text insertion | BRIDGE | no | lexical_model + web-view | P1 |
| [ ] | `COPY_COMMAND` | command | Dispatched on a copy event, either via the clipboard or a KeyboardEvent (Cmd+C on macOS, Ctrl+C elsewhere). | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `createCommand` | fn | Crete a command that can be used with `editor.dispatchCommand` and `editor.registerCommand`. | MODEL | yes (33 files) | lexical_model | P0 |
| [ ] | `CUT_COMMAND` | command | Dispatched on a cut event, either via the clipboard or a KeyboardEvent (Cmd+X on macOS, Ctrl+X elsewhere). | BRIDGE | yes (1 files) | lexical_model + web-view | P0 |
| [ ] | `DELETE_CHARACTER_COMMAND` | command | Dispatched to delete a character, the payload will be `true` if the deletion is backwards (backspace or delete on macOS) and `false` if forwards (delete or Fn+Delete on macOS). | MODEL | yes (2 files) | lexical_model | P0 |
| [ ] | `DELETE_LINE_COMMAND` | command | Dispatched to delete a line, the payload will be `true` if the deletion is backwards (Cmd+Delete on macOS), and `false` if forwards (Fn+Cmd+Delete on macOS). | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `DELETE_WORD_COMMAND` | command | Dispatched to delete a word, the payload will be `true` if the deletion is backwards (Ctrl+Backspace or Opt+Delete on macOS), and `false` if forwards (Ctrl+Delete or Fn+Opt+Delete on macOS). | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `DRAGEND_COMMAND` | command | command: dragend | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `DRAGOVER_COMMAND` | command | command: dragover | BRIDGE | yes (1 files) | lexical_model + web-view | P0 |
| [ ] | `DRAGSTART_COMMAND` | command | command: dragstart | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `DROP_COMMAND` | command | command: drop | BRIDGE | yes (1 files) | lexical_model + web-view | P0 |
| [ ] | `FOCUS_COMMAND` | command | command: focus | BRIDGE | yes (3 files) | lexical_model + web-view | P0 |
| [ ] | `FORMAT_ELEMENT_COMMAND` | command | command: format element | MODEL | no | lexical_model | P2 |
| [ ] | `FORMAT_TEXT_COMMAND` | command | Dispatched to format the selected text. | MODEL | yes (7 files) | lexical_model | P0 |
| [ ] | `INDENT_CONTENT_COMMAND` | command | command: indent content | MODEL | yes (2 files) | lexical_model | P0 |
| [ ] | `INPUT_COMMAND` | command | command: input | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `INSERT_LINE_BREAK_COMMAND` | command | Dispatched to insert a line break. | MODEL | no | lexical_model | P2 |
| [ ] | `INSERT_PARAGRAPH_COMMAND` | command | command: insert paragraph | MODEL | yes (3 files) | lexical_model | P0 |
| [ ] | `INSERT_TAB_COMMAND` | command | command: insert tab | MODEL | no | lexical_model | P1 |
| [ ] | `KEY_ARROW_DOWN_COMMAND` | command | Dispatched when the `'ArrowDown'` key is pressed. | BRIDGE | yes (8 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_ARROW_LEFT_COMMAND` | command | Dispatched when the `'ArrowLeft'` key is pressed. | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_ARROW_RIGHT_COMMAND` | command | Dispatched when the `'ArrowRight'` key is pressed. | BRIDGE | yes (6 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_ARROW_UP_COMMAND` | command | Dispatched when the `'ArrowUp'` key is pressed. | BRIDGE | yes (4 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_BACKSPACE_COMMAND` | command | Dispatched whenever the `'Backspace'` key is pressed, the shift modifier key may be down. | BRIDGE | yes (8 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_DELETE_COMMAND` | command | Dispatched whenever the `'Delete'` key is pressed (Fn+Delete on macOS). | BRIDGE | yes (3 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_DOWN_COMMAND` | command | Dispatched when any key is pressed. | BRIDGE | yes (4 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_ENTER_COMMAND` | command | Dispatched when the enter key is pressed, may also be called with a null payload when the intent is to insert a newline. | BRIDGE | yes (27 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_ESCAPE_COMMAND` | command | Dispatched whenever the `'Escape'` key is pressed, any modifier keys may be down. | BRIDGE | yes (14 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_MODIFIER_COMMAND` | command | command: key modifier | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `KEY_SPACE_COMMAND` | command | Dispatched whenever the space (`' '`) key is pressed, any modifier keys may be down. | BRIDGE | yes (1 files) | lexical_model + web-view | P0 |
| [ ] | `KEY_TAB_COMMAND` | command | Dispatched whenever the `'Tab'` key is pressed. | BRIDGE | yes (9 files) | lexical_model + web-view | P0 |
| [ ] | `MOVE_TO_END` | command | Dispatched when the move to end keyboard shortcut is pressed, (Cmd+Right on macOS; Ctrl+Right elsewhere). | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `MOVE_TO_START` | command | Dispatched when the move to start keyboard shortcut is pressed, (Cmd+Left on macOS; Ctrl+Left elsewhere). | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `OUTDENT_CONTENT_COMMAND` | command | command: outdent content | MODEL | yes (2 files) | lexical_model | P0 |
| [ ] | `PASTE_COMMAND` | command | command: paste | BRIDGE | yes (5 files) | lexical_model + web-view | P0 |
| [ ] | `PasteCommandType` | type | PASTE_COMMAND payload: ClipboardEvent \| InputEvent \| KeyboardEvent | VIEW | no | web-view | P2 |
| [ ] | `REDO_COMMAND` | command | Dispatched on redo (Shift+Cmd+Z on macOS, Shift+Ctrl+Z or Ctrl+Y elsewhere). | MODEL | yes (2 files) | lexical_model | P0 |
| [ ] | `REMOVE_TEXT_COMMAND` | command | command: remove text | MODEL | no | lexical_model | P2 |
| [ ] | `SELECT_ALL_COMMAND` | command | Dispatched on the select all keyboard shortcut (Cmd+A on macOS, Ctrl+A elsehwere). | BRIDGE | yes (3 files) | lexical_model + web-view | P0 |
| [ ] | `SELECTION_CHANGE_COMMAND` | command | command: selection change | BRIDGE | yes (6 files) | lexical_model + web-view | P0 |
| [ ] | `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` | command | command: selection insert clipboard nodes | MODEL | yes (3 files) | lexical_model | P0 |
| [ ] | `UNDO_COMMAND` | command | Dispatched on undo (Cmd+Z on macOS, Ctrl+Z elsewhere). | MODEL | yes (5 files) | lexical_model | P0 |
| [ ] | `IS_ALL_FORMATTING` | const | bitmask of all text format bits | MODEL | no | lexical_model | P2 |
| [ ] | `IS_BOLD` | const | text format bit 1 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_CODE` | const | text format bit 16 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_HIGHLIGHT` | const | text format bit 128 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_ITALIC` | const | text format bit 2 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_STRIKETHROUGH` | const | text format bit 4 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_SUBSCRIPT` | const | text format bit 32 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_SUPERSCRIPT` | const | text format bit 64 | MODEL | no | lexical_model | P1 |
| [ ] | `IS_UNDERLINE` | const | text format bit 8 | MODEL | no | lexical_model | P1 |
| [ ] | `NODE_STATE_KEY` | const | the `$` key under which NodeState is serialized in node JSON | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `TEXT_TYPE_TO_FORMAT` | const | map TextFormatType name -> format bit | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `DOMSlot` | class | Base class for DOM slots — a pointer to the content-bearing element of a node's DOM, plus optional `before` / `after` boundaries marking where the lexical-managed content sits inside that element. | VIEW | no | web-view | P1 |
| [ ] | `ElementDOMSlot` | class | A utility class for managing the DOM children of an ElementNode. | VIEW | no | web-view | P1 |
| [ ] | `CommandListener` | type | command handler signature (payload, editor) => boolean (true = handled, stop) | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `CommandListenerPriority` | type | priority 0..4 (EDITOR, LOW, NORMAL, HIGH, CRITICAL) | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `CommandListenerPriorityBefore` | type | priority arg form that runs before others at the same level | MODEL | no | lexical_model | P1 |
| [ ] | `CommandPayloadType` | type | Type helper for extracting the payload type from a command. | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `CreateEditorArgs` | type | createEditor config: namespace, nodes, theme, onError, editable, html, editorState, parentEditor, dom | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `DOMSlotForNode` | type | DOM slot type resolved for a node (ElementDOMSlot for elements, DOMSlot otherwise) | VIEW | no | web-view | P2 |
| [ ] | `EditableListener` | type | A listener that is called when {@link LexicalEditor.setEditable} changes the editable state of the editor. | MODEL | no | lexical_model | P2 |
| [ ] | `EditorConfig` | type | config passed to createDOM/updateDOM (namespace, theme, disableEvents) | VIEW | yes (39 files) | web-view | P0 |
| [ ] | `EditorDOMRenderConfig` | type | per-editor DOM render hooks ($createDOM, $updateDOM, $exportDOM, $getDOMSlot...) | VIEW | no | web-view | P2 |
| [ ] | `EditorSetOptions` | type | options for editor.setEditorState (tag) | MODEL | no | lexical_model | P2 |
| [ ] | `EditorThemeClasses` | type | theme class-name map (paragraph, heading, text formats, list, table, code tokens...) | VIEW | yes (33 files) | web-view | P0 |
| [ ] | `EditorThemeClassName` | type | string of space-separated class names | VIEW | no | web-view | P2 |
| [ ] | `EditorUpdateOptions` | type | editor.update options: onUpdate, skipTransforms, tag, discrete, event | MODEL | no | lexical_model | P2 |
| [ ] | `HTMLConfig` | type | createEditor html config: export map and import DOMConversionMap | BRIDGE | no | lexical_model + web-view | P1 |
| [ ] | `Klass` | type | constructor type of a LexicalNode subclass | MODEL | yes (6 files) | shim-only (TS type) | P0 |
| [ ] | `KlassConstructor` | type | typed constructor with static getType/clone/importJSON | MODEL | yes (2 files) | shim-only (TS type) | P0 |
| [ ] | `LexicalCommand` | type | typed command token created by createCommand | MODEL | yes (25 files) | lexical_model | P0 |
| [ ] | `LexicalEditor` | class | the editor: state, update/read, commands, listeners, transforms, root element, nodes registry | BRIDGE | yes (250 files) | lexical_model + web-view | P0 |
| [ ] | `LexicalNodeConfig` | type | A LexicalNode class or LexicalNodeReplacement configuration | MODEL | no | lexical_model | P2 |
| [ ] | `LexicalNodeReplacement` | type | Configuration entry passed in {@link CreateEditorArgs.nodes} to substitute a core node class with a custom subclass. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `MutationListener` | type | listener receiving Map<NodeKey, created\|updated\|destroyed> per node class | MODEL | yes (2 files) | lexical_model | P0 |
| [ ] | `NodeMutation` | type | 'created' \| 'updated' \| 'destroyed' | MODEL | yes (3 files) | lexical_model | P0 |
| [ ] | `RootListener` | type | A listener that is called when {@link LexicalEditor.setRootElement} changes the element that the editor is attached to. | MODEL | no | lexical_model | P2 |
| [ ] | `SerializedEditor` | type | JSON shape of Editor | MODEL | no | lexical_model | P2 |
| [ ] | `Spread` | type | TS helper type for extending serialized shapes | MODEL | yes (39 files) | shim-only (TS type) | P0 |
| [ ] | `Transform` | type | node transform fn (node) => void, run to fixpoint | MODEL | no | lexical_model | P2 |
| [ ] | `UpdateListener` | type | A listener that gets called after the editor is updated | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `UpdateListenerPayload` | type | The payload passed to an UpdateListener | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `COMMAND_PRIORITY_BEFORE_CRITICAL` | const | {@link LexicalEditor.registerCommand} listener added to the beginning of the critical priority queue (before high, normal, low, editor) | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `COMMAND_PRIORITY_BEFORE_EDITOR` | const | {@link LexicalEditor.registerCommand} listener added to the beginning of the editor priority queue (after critical, high, normal, low) | MODEL | no | lexical_model | P1 |
| [ ] | `COMMAND_PRIORITY_BEFORE_HIGH` | const | {@link LexicalEditor.registerCommand} listener added to the beginning of the high priority queue (after critical; before normal, low, editor) | MODEL | no | lexical_model | P1 |
| [ ] | `COMMAND_PRIORITY_BEFORE_LOW` | const | {@link LexicalEditor.registerCommand} listener added to the beginning of the low priority queue (after critical, high, normal; before editor) | MODEL | no | lexical_model | P1 |
| [ ] | `COMMAND_PRIORITY_BEFORE_NORMAL` | const | {@link LexicalEditor.registerCommand} listener added to the beginning of the normal priority queue (after critical, high; before low, editor) | MODEL | no | lexical_model | P1 |
| [ ] | `COMMAND_PRIORITY_CRITICAL` | const | {@link LexicalEditor.registerCommand} listener added to the end of the critical priority queue (before high, normal, low, editor) | MODEL | yes (16 files) | lexical_model | P0 |
| [ ] | `COMMAND_PRIORITY_EDITOR` | const | {@link LexicalEditor.registerCommand} listener added to the end of the editor priority queue (after critical, high, normal, low) | MODEL | yes (9 files) | lexical_model | P0 |
| [ ] | `COMMAND_PRIORITY_HIGH` | const | {@link LexicalEditor.registerCommand} listener added to the end of the high priority queue (after critical; before normal, low, editor) | MODEL | yes (23 files) | lexical_model | P0 |
| [ ] | `COMMAND_PRIORITY_LOW` | const | {@link LexicalEditor.registerCommand} listener added to the end of the low priority queue (after critical, high, normal; before editor) | MODEL | yes (26 files) | lexical_model | P0 |
| [ ] | `COMMAND_PRIORITY_NORMAL` | const | {@link LexicalEditor.registerCommand} listener added to the end of the normal priority queue (after critical, high; before low, editor) | MODEL | yes (36 files) | lexical_model | P0 |
| [ ] | `createEditor` | fn | Creates a new LexicalEditor attached to a single contentEditable (provided in the config). | BRIDGE | yes (85 files) | lexical_model + web-view | P0 |
| [ ] | `DEFAULT_EDITOR_DOM_CONFIG` | const | default EditorDOMRenderConfig delegating to node methods | VIEW | no | web-view | P2 |
| [ ] | `getTransformSetFromKlass` | fn | collect $transform from static $config chain of a node class | MODEL | no | lexical_model | P2 |
| [ ] | `EditorState` | class | immutable snapshot: nodeMap + selection; read(), toJSON(), clone() | MODEL | yes (14 files) | lexical_model | P0 |
| [ ] | `EditorStateReadOptions` | type | options for editorState.read (editor for context) | MODEL | no | lexical_model | P2 |
| [ ] | `SerializedEditorState` | type | JSON shape of EditorState | MODEL | yes (39 files) | lexical_model | P0 |
| [ ] | `$isEditorState` | fn | Type guard that returns true if the argument is an EditorState | MODEL | no | lexical_model | P2 |
| [ ] | `EventHandler` | type | DOM event handler (event, editor) => void | VIEW | no | web-view | P2 |
| [ ] | `stopLexicalPropagation` | fn | mark a DOM event so nested editors ignore it | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `BaseStaticNodeConfig` | type | This is the type of LexicalNode.$config() that can be overridden by subclasses. | MODEL | no | lexical_model | P2 |
| [ ] | `DOMChildConversion` | type | importDOM child callback applied to each child lexical node | BRIDGE | no | web-view | P2 |
| [ ] | `DOMConversion` | type | {conversion, priority} entry in importDOM map | BRIDGE | yes (6 files) | web-view | P0 |
| [ ] | `DOMConversionFn` | type | fn(element) -> DOMConversionOutput \| null | BRIDGE | no | web-view | P2 |
| [ ] | `DOMConversionMap` | type | tag name -> (node) => DOMConversion \| null | BRIDGE | yes (31 files) | web-view | P0 |
| [ ] | `DOMConversionOutput` | type | {node, after, forChild} result of a DOM conversion | BRIDGE | yes (4 files) | web-view | P0 |
| [ ] | `DOMConversionProp` | type | typed DOMConversion for a specific element type | BRIDGE | no | web-view | P2 |
| [ ] | `DOMConversionPropByTagName` | type | DOMConversionProp keyed by tag | BRIDGE | no | web-view | P2 |
| [ ] | `DOMConversionTagNameMap` | type | tag-name to element-type map for typed conversions | BRIDGE | no | web-view | P2 |
| [ ] | `DOMExportOutput` | type | {element, after} result of exportDOM | BRIDGE | yes (6 files) | lexical_html | P0 |
| [ ] | `DOMExportOutputMap` | type | Map<Klass, exportDOM override> for html.export | BRIDGE | no | lexical_html | P2 |
| [ ] | `LexicalExportJSON` | type | The most precise type we can infer for the JSON that will be produced by T.exportJSON(). | MODEL | no | lexical_model | P1 |
| [ ] | `LexicalNode` | class | base node: key, parent/siblings, getWritable/getLatest, replace/remove/insert, JSON, DOM hooks | BRIDGE | yes (129 files) | lexical_model + web-view | P0 |
| [ ] | `LexicalUpdateJSON` | type | Omit the children, type, and version properties from the given SerializedLexicalNode definition. | MODEL | yes (3 files) | lexical_model | P0 |
| [ ] | `NodeKey` | type | string node key | MODEL | yes (73 files) | lexical_model | P0 |
| [ ] | `NodeMap` | type | Map<NodeKey, LexicalNode> | MODEL | no | lexical_model | P2 |
| [ ] | `SerializedLexicalNode` | type | The base type for all serialized nodes | MODEL | yes (47 files) | lexical_model | P0 |
| [ ] | `StaticNodeConfig` | type | Used to extract the node and type from a StaticNodeConfigRecord | MODEL | no | lexical_model | P2 |
| [ ] | `StaticNodeConfigRecord` | type | shape of the $config() record (type, extends, stateConfigs, importDOM, $transform) | MODEL | no | lexical_model | P2 |
| [ ] | `StaticNodeConfigValue` | type | EXPERIMENTAL The configuration of a node returned by LexicalNode.$config() | MODEL | no | lexical_model | P2 |
| [ ] | `$isLexicalNode` | fn | Returns true if the given value is a {@link LexicalNode} instance. | MODEL | no | lexical_model | P2 |
| [ ] | `buildImportMap` | fn | An identity function that will infer the type of DOM nodes based on tag names to make it easier to construct a DOMConversionMap. | MODEL | no | lexical_model | P2 |
| [ ] | `$getState` | fn | The accessor for working with node state. | MODEL | yes (5 files) | lexical_model | P0 |
| [ ] | `$getStateChange` | fn | Given two versions of a node and a stateConfig, compare their state values using `$getState(nodeVersion, stateConfig, 'direct')`. | MODEL | no | lexical_model | P1 |
| [ ] | `$getWritableNodeState` | fn | get the writable NodeState of a writable node | MODEL | no | lexical_model | P2 |
| [ ] | `$setState` | fn | Set the state defined by stateConfig on node. | MODEL | yes (5 files) | lexical_model | P0 |
| [ ] | `AnyStateConfig` | type | For advanced use cases, using this type is not recommended unless it is required (due to TypeScript's lack of features like higher-kinded types). | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `createSharedNodeState` | fn | internal: per-registered-node shared state config table | MODEL | no | lexical_model | P2 |
| [ ] | `createState` | fn | Create a StateConfig for the given string key and StateValueConfig. | MODEL | yes (5 files) | lexical_model | P0 |
| [ ] | `NodeStateJSON` | type | The NodeState JSON produced by this LexicalNode | MODEL | no | lexical_model | P1 |
| [ ] | `StateConfig` | class | The return value of {@link createState}, for use with {@link $getState} and {@link $setState}. | MODEL | no | lexical_model | P1 |
| [ ] | `StateConfigKey` | type | Get the key type (K) from a StateConfig | MODEL | no | lexical_model | P2 |
| [ ] | `StateConfigValue` | type | Get the value type (V) from a StateConfig | MODEL | no | lexical_model | P1 |
| [ ] | `StateValueConfig` | type | Configure a value to be used with StateConfig. | MODEL | no | lexical_model | P2 |
| [ ] | `StateValueOrUpdater` | type | A type alias to make it easier to define setter methods on your node class | MODEL | no | lexical_model | P1 |
| [ ] | `ValueOrUpdater` | type | A value type, or an updater for that value type. | MODEL | no | lexical_model | P2 |
| [ ] | `$normalizeSelection__EXPERIMENTAL` | fn | normalize a RangeSelection's points to leaf text/element positions | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `BaseSelection` | type | interface shared by Range/Node/Table selections (getNodes, insertText, clone, is, dirty...) | MODEL | yes (8 files) | lexical_model | P0 |
| [ ] | `ElementPoint` | type | Point of type 'element' (offset = child index) | MODEL | no | lexical_model | P2 |
| [ ] | `NodeSelection` | class | selection of whole nodes by key set | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `Point` | class | selection point: key, offset, type ('text'\|'element') | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `PointType` | type | TextPoint \| ElementPoint | MODEL | yes (1 files) | shim-only (TS type) | P0 |
| [ ] | `RangeSelection` | class | anchor/focus range selection with format/style; insertText, insertNodes, deleteCharacter, formatText, modify... | MODEL | yes (18 files) | lexical_model | P0 |
| [ ] | `TextPoint` | type | Point of type 'text' (offset = UTF-16 offset) | MODEL | no | lexical_model | P2 |
| [ ] | `$createNodeSelection` | fn | factory for NodeSelection (applies node replacement) | MODEL | yes (13 files) | lexical_model | P0 |
| [ ] | `$createPoint` | fn | factory for Point (applies node replacement) | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$createRangeSelection` | fn | factory for RangeSelection (applies node replacement) | MODEL | yes (13 files) | lexical_model | P0 |
| [ ] | `$createRangeSelectionFromDom` | fn | factory for RangeSelectionFromDom (applies node replacement) | VIEW | no | shim | P2 |
| [ ] | `$generateNodesFromRawText` | fn | Convert a raw text string into a flat array of `TextNode`, `LineBreakNode`, and `TabNode` siblings, splitting on `\n`, `\r\n`, and `\t`. | MODEL | no | lexical_model | P2 |
| [ ] | `$getCharacterOffsets` | fn | [anchorOffset, focusOffset] normalized for a selection | MODEL | no | lexical_model | P2 |
| [ ] | `$getPreviousSelection` | fn | selection of the previous (committed) editor state | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$getSelection` | fn | current selection in the active editor state | MODEL | yes (84 files) | lexical_model | P0 |
| [ ] | `$getTextContent` | fn | text content of the current selection | MODEL | no | lexical_model | P2 |
| [ ] | `$insertNodes` | fn | insert nodes at the current selection (creating a selection at root end if none) | MODEL | yes (20 files) | lexical_model | P0 |
| [ ] | `$isBlockElementNode` | fn | type guard for BlockElementNode | MODEL | no | lexical_model | P2 |
| [ ] | `$isNodeSelection` | fn | type guard for NodeSelection | MODEL | yes (9 files) | lexical_model | P0 |
| [ ] | `$isRangeSelection` | fn | type guard for RangeSelection | MODEL | yes (73 files) | lexical_model | P0 |
| [ ] | `$updateDOMSelection` | fn | apply model selection to DOM selection (view) | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `RawTextVisitor` | type | Push-lexer visitor passed to {@link tokenizeRawText}. | MODEL | no | lexical_model | P2 |
| [ ] | `tokenizeRawText` | fn | Push-lex a raw text string into `linebreak` (`\n` / `\r\n`), `tab` (`\t`), and `text` (everything else) tokens, dispatching each to the matching callback on `visitor` in source order. | MODEL | no | lexical_model | P2 |
| [ ] | `$fullReconcile` | fn | Schedule a full reconcile of the active editor, so that every node is re-rendered through the current {@link EditorDOMRenderConfig } on the next commit. | BRIDGE | no | lexical_model + shim | P2 |
| [ ] | `$parseSerializedNode` | fn | deserialize one SerializedLexicalNode into a node (with children) | MODEL | yes (7 files) | lexical_model | P0 |
| [ ] | `isCurrentlyReadOnlyMode` | fn | true inside read() / read-only phase | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$addUpdateTag` | fn | add a tag to the current update | MODEL | yes (10 files) | lexical_model | P0 |
| [ ] | `$applyNodeReplacement` | fn | apply registered node replacement (withKlass/with) to a freshly created node | MODEL | yes (36 files) | lexical_model | P0 |
| [ ] | `$cloneWithProperties` | fn | Returns a clone of a node using `node.constructor.clone()` followed by `clone.afterCloneFrom(node)`. | MODEL | no | lexical_model | P2 |
| [ ] | `$cloneWithPropertiesEphemeral` | fn | Returns a clone with {@link $cloneWithProperties} and then "detaches" it from the state by overriding its getLatest and getWritable to always return this. | MODEL | no | lexical_model | P2 |
| [ ] | `$copyNode` | fn | Returns a shallow clone of node with a new key. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$create` | fn | Create an node from its class. | MODEL | no | lexical_model | P1 |
| [ ] | `$createChildrenArray` | fn | factory for ChildrenArray (applies node replacement) | MODEL | no | lexical_model | P2 |
| [ ] | `$findMatchingParent` | fn | Starts with a node and moves up the tree (toward the root node) to find a matching node based on the search parameters of the findFn. | MODEL | yes (8 files) | lexical_model | P0 |
| [ ] | `$getAdjacentNode` | fn | node adjacent to a point in a direction (for caret moves around decorators) | MODEL | no | lexical_model | P2 |
| [ ] | `$getDOMSlot` | fn | DOM slot for an element node (view) | VIEW | no | shim | P1 |
| [ ] | `$getDOMTextNode` | fn | DOM Text node for a TextNode (view) | VIEW | no | shim | P2 |
| [ ] | `$getEditor` | fn | Utility function for accessing current active editor instance. | MODEL | yes (5 files) | lexical_model | P0 |
| [ ] | `$getEditorDOMRenderConfig` | fn | resolved EditorDOMRenderConfig for the active editor | VIEW | no | shim | P2 |
| [ ] | `$getNearestNodeFromDOMNode` | fn | nearest lexical node owning a DOM node (view) | VIEW | yes (12 files) | web-view | P0 |
| [ ] | `$getNearestRootOrShadowRoot` | fn | nearest ancestor that is root or isShadowRoot() | MODEL | no | lexical_model | P2 |
| [ ] | `$getNodeByKey` | fn | look up a node by key in the active state | MODEL | yes (66 files) | lexical_model | P0 |
| [ ] | `$getNodeByKeyOrThrow` | fn | look up a node by key, throwing if missing | MODEL | no | lexical_model | P1 |
| [ ] | `$getNodeFromDOMNode` | fn | lexical node for an exact DOM node (view) | VIEW | no | shim | P2 |
| [ ] | `$getRoot` | fn | the RootNode of the active state | MODEL | yes (186 files) | lexical_model | P0 |
| [ ] | `$hasAncestor` | fn | true if node has the given ancestor | MODEL | no | lexical_model | P2 |
| [ ] | `$hasUpdateTag` | fn | true if the current update carries a tag | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$isElementDOMSlot` | fn | type guard for ElementDOMSlot | VIEW | no | shim | P1 |
| [ ] | `$isInlineElementOrDecoratorNode` | fn | type guard for InlineElementOrDecoratorNode | MODEL | no | lexical_model | P2 |
| [ ] | `$isLeafNode` | fn | type guard for LeafNode | MODEL | no | lexical_model | P2 |
| [ ] | `$isRootOrShadowRoot` | fn | type guard for RootOrShadowRoot | MODEL | yes (12 files) | lexical_model | P0 |
| [ ] | `$isTokenOrSegmented` | fn | Return true if the TextNode is a TabNode, or is in token or segmented mode. | MODEL | no | lexical_model | P1 |
| [ ] | `$isTokenOrTab` | fn | Return true if the TextNode is a TabNode or is in token mode. | MODEL | no | lexical_model | P2 |
| [ ] | `$nodesOfType` | fn | all nodes of a class in the active state (deprecated) | MODEL | yes (6 files) | lexical_model | P0 |
| [ ] | `$onUpdate` | fn | Add a function to run after the current update. | MODEL | no | lexical_model | P1 |
| [ ] | `$selectAll` | fn | select the whole root content | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$setCompositionKey` | fn | set/clear the key of the node under IME composition | MODEL | no | lexical_model | P1 |
| [ ] | `$setDirectionFromDOM` | fn | Reads the `dir` attribute from a DOM element and applies it to the given ElementNode via {@link ElementNode.setDirection} when it is a valid direction value (`'ltr'` or `'rtl'`). | BRIDGE | no | web-view | P2 |
| [ ] | `$setFormatFromDOM` | fn | Reads the `style` and CSS `textAlign` property from a DOM element and set format to the given ElementNode via {@link ElementNode.setFormat} when it is a valid alignment value {@link ElementFormatType} Other values, inclu | BRIDGE | no | web-view | P2 |
| [ ] | `$setSelection` | fn | replace the active selection | MODEL | yes (38 files) | lexical_model | P0 |
| [ ] | `$splitNode` | fn | split an element at an offset, returning [left, right] | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `getDOMOwnerDocument` | fn | owner document of a DOM node (view) | VIEW | no | web-view | P2 |
| [ ] | `getDOMSelection` | fn | Returns the selection for the given window, or the global window if null. | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `getDOMSelectionFromTarget` | fn | Returns the selection for the defaultView of the ownerDocument of given EventTarget. | VIEW | no | web-view | P2 |
| [ ] | `getDOMTextNode` | fn | first DOM Text node under an element (view) | VIEW | no | web-view | P1 |
| [ ] | `getEditorPropertyFromDOMNode` | fn | read __lexicalEditor from a DOM node (view) | VIEW | no | web-view | P2 |
| [ ] | `getNearestEditorFromDOMNode` | fn | nearest LexicalEditor owning a DOM node (view) | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `getRegisteredNode` | fn | RegisteredNode record for a node type, or undefined | MODEL | no | lexical_model | P1 |
| [ ] | `getRegisteredNodeOrThrow` | fn | RegisteredNode record for a node type, throwing if unregistered | MODEL | no | lexical_model | P2 |
| [ ] | `getStaticNodeConfig` | fn | resolved static $config() of a node class (cached) | MODEL | no | lexical_model | P1 |
| [ ] | `getTextDirection` | fn | detect 'ltr'\|'rtl'\|null from text by first strong character | MODEL | no | lexical_model | P1 |
| [ ] | `INTERNAL_$isBlock` | fn | internal: element is a block (not inline, cannot be empty or first child inline) | MODEL | no | lexical_model | P2 |
| [ ] | `isBlockDomNode` | fn | DOM node is a block element (view, html import) | VIEW | no | web-view | P2 |
| [ ] | `isDocumentFragment` | fn | DOM node is a DocumentFragment | VIEW | no | web-view | P2 |
| [ ] | `isDOMDocumentNode` | fn | DOM node is a Document | VIEW | no | web-view | P2 |
| [ ] | `isDOMNode` | fn | value is a DOM Node | VIEW | no | web-view | P2 |
| [ ] | `isDOMTextNode` | fn | DOM node is a Text node | VIEW | no | web-view | P2 |
| [ ] | `isDOMUnmanaged` | fn | True if this DOM node was marked with {@link setDOMUnmanaged}. | VIEW | no | web-view | P2 |
| [ ] | `isExactShortcutMatch` | fn | Match a KeyboardEvent with its expected state | VIEW | no | web-view | P1 |
| [ ] | `isHTMLAnchorElement` | fn | DOM node is <a> | VIEW | no | web-view | P2 |
| [ ] | `isHTMLElement` | fn | value is an HTMLElement | VIEW | yes (2 files) | web-view | P0 |
| [ ] | `isHTMLTableCellElement` | fn | DOM node is <td>/<th> | VIEW | no | web-view | P2 |
| [ ] | `isHTMLTableRowElement` | fn | DOM node is <tr> | VIEW | no | web-view | P2 |
| [ ] | `isInlineDomNode` | fn | DOM node is an inline element (view, html import) | VIEW | no | web-view | P1 |
| [ ] | `isLexicalEditor` | fn | value is a LexicalEditor | MODEL | no | lexical_model | P2 |
| [ ] | `isModifierMatch` | fn | Match a KeyboardEvent with its expected modifier state | VIEW | no | web-view | P2 |
| [ ] | `isSelectionCapturedInDecoratorInput` | fn | DOM focus is in an input inside a decorator (view) | VIEW | no | web-view | P2 |
| [ ] | `isSelectionWithinEditor` | fn | DOM selection is inside the editor root (view) | VIEW | no | web-view | P1 |
| [ ] | `removeFromParent` | fn | Removes a node from its parent, updating all necessary pointers and links. | MODEL | no | lexical_model | P1 |
| [ ] | `resetRandomKey` | fn | reset the global node key counter (tests) | MODEL | no | lexical_model | P1 |
| [ ] | `setDOMUnmanaged` | fn | Mark this DOM element as unmanaged by lexical's mutation observer (like decorator nodes are). | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `setNodeIndentFromDOM` | fn | set element indent from DOM padding-inline-start during import | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `toggleTextFormatType` | fn | toggle a format bit in a format bitmask (sub/superscript and case formats mutually exclusive) | MODEL | no | lexical_model | P2 |
| [ ] | `ArtificialNode__DO_NOT_USE` | class | temporary element used by HTML import to wrap orphan inlines; unwrapped afterwards | MODEL | no | lexical_model | P2 |
| [ ] | `$isDecoratorNode` | fn | type guard for DecoratorNode | MODEL | yes (6 files) | lexical_model | P0 |
| [ ] | `DecoratorNode` | class | leaf node rendered by an external decorator (inline or block); keyboard-selectable | BRIDGE | yes (27 files) | lexical_model + web-view | P0 |
| [ ] | `ElementFormatType` | type | 'left'\|'start'\|'center'\|'right'\|'end'\|'justify'\|'' | MODEL | yes (1 files) | shim-only (TS type) | P0 |
| [ ] | `SerializedElementNode` | type | JSON shape of ElementNode | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `$isElementNode` | fn | type guard for ElementNode | MODEL | yes (62 files) | lexical_model | P0 |
| [ ] | `ElementNode` | class | node with children; format, indent, direction, textFormat/textStyle; split/merge/collapse rules | BRIDGE | yes (48 files) | lexical_model + web-view | P0 |
| [ ] | `SerializedLineBreakNode` | type | JSON shape of LineBreakNode | MODEL | no | lexical_model | P2 |
| [ ] | `$createLineBreakNode` | fn | factory for LineBreakNode (applies node replacement) | MODEL | yes (7 files) | lexical_model | P0 |
| [ ] | `$isLineBreakNode` | fn | type guard for LineBreakNode | MODEL | yes (7 files) | lexical_model | P0 |
| [ ] | `LineBreakNode` | class | hard line break leaf (<br>), text content '\n' | BRIDGE | yes (5 files) | lexical_model + web-view | P0 |
| [ ] | `SerializedParagraphNode` | type | JSON shape of ParagraphNode | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$createParagraphNode` | fn | factory for ParagraphNode (applies node replacement) | MODEL | yes (108 files) | lexical_model | P0 |
| [ ] | `$isParagraphNode` | fn | type guard for ParagraphNode | MODEL | yes (30 files) | lexical_model | P0 |
| [ ] | `ParagraphNode` | class | default block element (<p>) | BRIDGE | yes (16 files) | lexical_model + web-view | P0 |
| [ ] | `SerializedRootNode` | type | JSON shape of RootNode | MODEL | no | lexical_model | P2 |
| [ ] | `$isRootNode` | fn | type guard for RootNode | MODEL | yes (10 files) | lexical_model | P0 |
| [ ] | `RootNode` | class | document root; only element/decorator children; cannot be removed/replaced | BRIDGE | yes (6 files) | lexical_model + web-view | P0 |
| [ ] | `SerializedTabNode` | type | JSON shape of TabNode | MODEL | no | lexical_model | P2 |
| [ ] | `$createTabNode` | fn | factory for TabNode (applies node replacement) | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$isTabNode` | fn | type guard for TabNode | MODEL | no | lexical_model | P1 |
| [ ] | `TabNode` | class | TextNode subclass for '\t', token-like, unmergeable | BRIDGE | yes (1 files) | lexical_model + web-view | P0 |
| [ ] | `SerializedTextNode` | type | JSON shape of TextNode | MODEL | yes (3 files) | lexical_model | P0 |
| [ ] | `TextFormatType` | type | format names: bold, italic, underline, strikethrough, code, subscript, superscript, highlight, lowercase, uppercase, capitalize | MODEL | yes (10 files) | shim-only (TS type) | P0 |
| [ ] | `TextModeType` | type | 'normal'\|'token'\|'segmented' | MODEL | no | shim-only (TS type) | P1 |
| [ ] | `$createTextNode` | fn | factory for TextNode (applies node replacement) | MODEL | yes (90 files) | lexical_model | P0 |
| [ ] | `$isTextNode` | fn | type guard for TextNode | MODEL | yes (39 files) | lexical_model | P0 |
| [ ] | `TextNode` | class | leaf text: text, format bitmask, style string, mode, detail (directionless/unmergeable) | BRIDGE | yes (30 files) | lexical_model + web-view | P0 |
| [ ] | `COLLABORATION_TAG` | const | Indicates that the update is related to collaborative editing | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `COMPOSITION_END_TAG` | const | The update was triggered by composition-end | MODEL | no | lexical_model | P1 |
| [ ] | `COMPOSITION_START_TAG` | const | The update was triggered by composition-start | MODEL | no | lexical_model | P2 |
| [ ] | `HISTORIC_TAG` | const | Indicates that the update is related to history operations (undo/redo) | MODEL | no | lexical_model | P1 |
| [ ] | `HISTORY_MERGE_TAG` | const | Indicates that the current update should be merged with the previous history entry | MODEL | no | lexical_model | P1 |
| [ ] | `HISTORY_PUSH_TAG` | const | Indicates that a new history entry should be pushed to the history stack | MODEL | yes (3 files) | lexical_model | P0 |
| [ ] | `PASTE_TAG` | const | Indicates that the update is related to a paste operation | MODEL | no | lexical_model | P2 |
| [ ] | `SKIP_COLLAB_TAG` | const | Indicates that the update should skip collaborative sync | BRIDGE | no | lexical_model + web-view | P2 |
| [ ] | `SKIP_DOM_SELECTION_TAG` | const | Indicates that the update should skip updating the DOM selection This is useful when you want to make updates without changing the selection or focus | BRIDGE | yes (4 files) | lexical_model + web-view | P0 |
| [ ] | `SKIP_SCROLL_INTO_VIEW_TAG` | const | Indicates that the update should skip scrolling the selection into view | BRIDGE | yes (2 files) | lexical_model + web-view | P0 |
| [ ] | `SKIP_SELECTION_FOCUS_TAG` | const | Indicates that after changing the selection, the editor should not focus itself This tag is ignored if {@link SKIP_DOM_SELECTION_TAG} is used | BRIDGE | yes (1 files) | lexical_model + web-view | P0 |
| [ ] | `UpdateTag` | type | The set of known update tags to help with TypeScript suggestions. | MODEL | no | lexical_model | P2 |
| [ ] | `CAN_USE_BEFORE_INPUT` | const | browser supports beforeinput (view) | VIEW | no | web-view | P1 |
| [ ] | `CAN_USE_DOM` | const | Copyright (c) Meta Platforms, Inc. | VIEW | no | web-view | P1 |
| [ ] | `IS_ANDROID` | const | UA flag | VIEW | no | web-view | P1 |
| [ ] | `IS_ANDROID_CHROME` | const | UA flag | VIEW | no | web-view | P1 |
| [ ] | `IS_APPLE` | const | UA flag | VIEW | yes (2 files) | web-view | P0 |
| [ ] | `IS_APPLE_WEBKIT` | const | UA flag | VIEW | no | web-view | P1 |
| [ ] | `IS_CHROME` | const | UA flag | VIEW | no | web-view | P1 |
| [ ] | `IS_FIREFOX` | const | UA flag | VIEW | no | web-view | P1 |
| [ ] | `IS_IOS` | const | UA flag | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `IS_SAFARI` | const | UA flag | VIEW | no | web-view | P1 |
| [ ] | `AnyLexicalExtension` | type | Any concrete {@link LexicalExtension} | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `AnyLexicalExtensionArgument` | type | Any {@link LexicalExtension} or {@link NormalizedLexicalExtensionArgument} | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `AnyNormalizedLexicalExtensionArgument` | type | Any {@link NormalizedLexicalExtensionArgument} | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `configExtension` | fn | Override a partial of the configuration of an Extension, to be used in the dependencies array of another extension, or as an argument to {@link buildEditorFromExtensions }. | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `configTypeSymbol` | const+type | phantom symbol carrying an extension's Config type | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `declarePeerDependency` | fn | Used to declare a peer dependency of an extension in a type-safe way, requires the type parameter. | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `defineExtension` | fn | Define a LexicalExtension from the given object literal. | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `ExtensionBuildState` | type | internal build-state of an extension in LexicalBuilder | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `ExtensionConfigBase` | type | The default extension configuration of an empty object | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `ExtensionInitState` | type | An object that the init method can use to access the configuration for extension dependencies | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `ExtensionRegisterState` | type | An object that the register method can use to detect unmount and access the configuration for extension dependencies | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `InitialEditorConfig` | type | editor config subset an extension may contribute (namespace, theme, nodes, html, onError, editable, editorState) | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `InitialEditorStateType` | type | All of the possible ways to initialize $initialEditorState: - `null` an empty state, the default - `string` an EditorState serialized to JSON - `EditorState` an EditorState that has been deserialized already (not just pa | MODEL | no | shim-only (TS type) | P1 |
| [ ] | `initTypeSymbol` | const+type | phantom symbol carrying an extension's Init type | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalEditorWithDispose` | type | A handle to the editor with an attached dispose function | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `LexicalExtension` | type | An Extension is a composable unit of LexicalEditor configuration (nodes, theme, etc) used to create an editor, plus runtime behavior that is registered after the editor is created. | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `LexicalExtensionArgument` | type | A {@link LexicalExtension} or {@link NormalizedLexicalExtensionArgument} (extension with config overrides) | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionConfig` | type | Extract the Config type from an Extension | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionDependency` | type | resolved dependency handle: config + output of a built extension | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `LexicalExtensionInit` | type | Extract the Init type from an Extension | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionInternal` | type | internal phantom-typed extension shape | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `LexicalExtensionName` | type | Extract the Name type from an Extension | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionOutput` | type | Extract the Output type from an Extension | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `NormalizedLexicalExtensionArgument` | type | A tuple of `[extension, ...configOverrides]` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `NormalizedPeerDependency` | type | The result of {@link declarePeerDependency }, a tuple of a peer dependency name and its associated configuration. | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `OutputComponentExtension` | type | An Extension that has an OutputComponent of the given type (e.g. | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `OutputExtension` | type | An Extension that has an Output of the given type | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `outputTypeSymbol` | const+type | phantom symbol carrying an extension's Output type | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `safeCast` | fn | Explicitly and safely cast a value to a specific type when inference or satisfies isn't going to work as expected (often useful for the config property with {@link defineExtension }) | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `shallowMergeConfig` | fn | The default merge strategy for extension configuration is a shallow merge. | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `addClassNamesToElement` | fn | Takes an HTML element and adds the classNames passed within an array, ignoring any non-string types. | VIEW | no | web-view | P1 |
| [ ] | `normalizeClassNames` | fn | split/trim class-name strings into a token array | VIEW | no | web-view | P2 |
| [ ] | `removeClassNamesFromElement` | fn | Takes an HTML element and removes the classNames passed within an array, ignoring any non-string types. | VIEW | no | web-view | P1 |
| [ ] | `mergeRegister` | fn | Returns a function that will execute all functions passed when called. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `getStyleObjectFromCSS` | fn | Parses inline CSS text into an object that is compatible with `CSSStyleDeclaration.setProperty()`. | MODEL | no | lexical_model | P1 |
| [ ] | `setDOMStyleFromCSS` | fn | Applies inline CSS text to a DOM style declaration using `CSSStyleDeclaration.setProperty()`. | VIEW | no | web-view | P1 |
| [ ] | `setDOMStyleObject` | fn | Applies a style object to a DOM style declaration using `CSSStyleDeclaration.setProperty()`. | VIEW | no | web-view | P1 |

### `@lexical/clipboard` (29 exports: 29 own, 0 re-exported; MODEL 19 / BRIDGE 8 / VIEW 2; P0 5 / P1 9 / P2 15; imported by Macro: 5)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `caretFromPoint` | fn | DOM caret position from viewport coords (drop target) (view) | VIEW | no | web-view | P1 |
| [ ] | `$exportMimeTypeFromSelection` | fn | Serialize the given selection for a single MIME type using the active editor's configured {@link ExportMimeTypeConfig}. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$generateJSONFromSelectedNodes` | fn | Gets the Lexical JSON of the nodes inside the provided Selection. | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$generateNodesFromSerializedNodes` | fn | This method takes an array of objects conforming to the BaseSerializedNode interface and returns an Array containing instances of the corresponding LexicalNode classes registered on the editor. | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$getClipboardDataFromSelection` | fn | Serialize the content of the current selection to strings in text/plain, text/html, and application/x-lexical-editor (Lexical JSON) formats (as available). | BRIDGE | yes (1 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `$getHtmlContent` | fn | Returns the *currently selected* Lexical content as an HTML string, relying on the logic defined in the exportDOM methods on the LexicalNode classes. | BRIDGE | no | lexical_rich_nodes + shim | P2 |
| [ ] | `$getLexicalContent` | fn | Returns the *currently selected* Lexical content as a JSON string, relying on the logic defined in the exportJSON methods on the LexicalNode classes. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$handlePlainTextDrop` | fn | Drop handler for plain-text editors. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$handleRichTextDrop` | fn | Drop handler for rich-text editors. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$insertDataTransferForPlainText` | fn | Attempts to insert content of the mime-types text/plain or text/uri-list from the provided DataTransfer object into the editor at the provided selection. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `$insertDataTransferForRichText` | fn | Insert the contents of `dataTransfer` at `selection` using the rich-text import pipeline (`application/x-lexical-editor` → `text/html` → `text/plain` → `text/uri-list`, in descending order of priority). | BRIDGE | yes (1 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `$insertGeneratedNodes` | fn | Inserts Lexical nodes into the editor using different strategies depending on some simple selection-based heuristics. | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$writeDragSourceToDataTransfer` | fn | Populate `dataTransfer` with a marker identifying the current editor as a drag source. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `copyToClipboard` | fn | Copies the content of the current selection to the clipboard in text/plain, text/html, and application/x-lexical-editor (Lexical JSON) formats. | BRIDGE | no | lexical_rich_nodes + shim | P2 |
| [ ] | `ExportMimeTypeConfig` | type | A mapping from MIME type to a stack of {@link ExportMimeTypeFunction}. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ExportMimeTypeFunction` | type | A function that produces the serialized representation of a selection for a single MIME type. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `GetClipboardDataConfig` | type | Configuration for {@link GetClipboardDataExtension}. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `GetClipboardDataExtension` | extension | Lexical extension that controls how the current selection is serialized into clipboard MIME types when copying or dragging out of the editor. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `LexicalClipboardData` | type | {'text/html', 'application/x-lexical-editor', 'text/plain'} payload | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `setLexicalClipboardDataTransfer` | fn | Call setData on the given clipboardData for each MIME type present in the given data (from {@link $getClipboardDataFromSelection}) | VIEW | no | web-view | P1 |
| [ ] | `ClipboardDOMImportExtension` | extension | clipboard import using the DOMImportExtension HTML importer | BRIDGE | no | lexical_rich_nodes + shim | P2 |
| [ ] | `ClipboardImportConfig` | type | Configuration for {@link ClipboardImportExtension}. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ClipboardImportExtension` | extension | configurable clipboard import pipeline (mime handlers, priority) | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `ClipboardImportOutput` | type | Output of {@link ClipboardImportExtension}: the merged configuration plus a self-contained {@link $insertDataTransfer} function that owns the entire paste-side iteration over the priority list. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `DEFAULT_IMPORT_MIME_TYPE` | const | The default per-MIME-type handler stacks reproducing the legacy {@link $insertDataTransferForRichText } behavior exactly. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `DEFAULT_IMPORT_MIME_TYPE_PRIORITY` | const | Default per-MIME-type weights reproducing the legacy `$insertDataTransferForRichText` ordering: `application/x-lexical-editor` (0) → `text/html` (10) → `text/plain` (20) → `text/uri-list` (30). | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ImportMimeTypeConfig` | type | A mapping from MIME type to a stack of {@link ImportMimeTypeFunction}. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ImportMimeTypeFunction` | type | A middleware function in a per-MIME-type clipboard-import stack. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ImportMimeTypePriority` | type | Per-MIME-type ordering weights. | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/code` (28 exports: 1 own, 27 re-exported; MODEL 23 / BRIDGE 4 / VIEW 1; P0 9 / P1 3 / P2 16; imported by Macro: 9)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `SerializedCodeNode` | type | re-export of `@lexical/code-core` | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `$createCodeHighlightNode` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$createCodeNode` | fn | re-export of `@lexical/code-core` | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$getCodeLineDirection` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getEndOfCodeInLine` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getFirstCodeNodeOfLine` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getLastCodeNodeOfLine` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getStartOfCodeInLine` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$isCodeHighlightNode` | fn | re-export of `@lexical/code-core` | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$isCodeNode` | fn | re-export of `@lexical/code-core` | MODEL | yes (12 files) | lexical_rich_nodes | P0 |
| [ ] | `$outdentLeadingSpaces` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodeExtension` | extension | re-export of `@lexical/code-core` | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `CodeHighlightNode` | class | re-export of `@lexical/code-core` | BRIDGE | yes (2 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `CodeIndentConfig` | type | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodeIndentExtension` | extension | re-export of `@lexical/code-core` | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `CodeNode` | class | re-export of `@lexical/code-core` | BRIDGE | yes (8 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `DEFAULT_CODE_LANGUAGE` | const | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getDefaultCodeLanguage` | fn | re-export of `@lexical/code-core` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CODE_LANGUAGE_FRIENDLY_NAME_MAP` | const | re-export of `@lexical/code-prism` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CODE_LANGUAGE_MAP` | const | re-export of `@lexical/code-prism` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getCodeLanguageOptions` | const | re-export of `@lexical/code-prism` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getCodeLanguages` | const | re-export of `@lexical/code-prism` | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `getCodeThemeOptions` | const | re-export of `@lexical/code-prism` | VIEW | no | not-needed | P2 |
| [ ] | `getLanguageFriendlyName` | const | re-export of `@lexical/code-prism` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `normalizeCodeLang` | const | deprecated alias of normalizeCodeLanguage | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `normalizeCodeLanguage` | const | re-export of `@lexical/code-prism` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `PrismTokenizer` | const | re-export of `@lexical/code-prism` | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `registerCodeHighlighting` | const | re-export of `@lexical/code-prism` | MODEL | yes (2 files) | lexical_rich_nodes | P0 |

### `@lexical/code-core` (22 exports: 22 own, 0 re-exported; MODEL 17 / BRIDGE 5 / VIEW 0; P0 6 / P1 4 / P2 12; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `CodeExtension` | extension | Add code blocks to the editor (syntax highlighting provided separately) | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `$createCodeHighlightNode` | fn | factory for CodeHighlightNode (applies node replacement) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$isCodeHighlightNode` | fn | type guard for CodeHighlightNode | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `CodeHighlightNode` | class | TextNode subclass with highlightType (Prism token class); stored in docs | BRIDGE | via `@lexical/code` | lexical_rich_nodes + web-view | P0 |
| [ ] | `CodeImportExtension` | extension | Bundles {@link CodeImportRules} (plus {@link CoreImportExtension}) into a single dependency. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `CodeImportRules` | const | Import rules for {@link CodeNode }. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodeIndentConfig` | type | CodeIndentExtension config: tab size / indent string | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodeIndentExtension` | extension | Adds keyboard-driven indentation to code blocks (Tab / Shift+Tab, alt+arrow line shifts, Home/End within a line). | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `registerCodeIndentation` | fn | register code-block tab/indent/outdent/home/end/line-move handlers (see §3C) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `SerializedCodeNode` | type | JSON shape of CodeNode | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `$createCodeNode` | fn | factory for CodeNode (applies node replacement) | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `$isCodeNode` | fn | type guard for CodeNode | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `CodeNode` | class | code block element: language, theme, isSyntaxHighlightSupported | BRIDGE | via `@lexical/code` | lexical_rich_nodes + web-view | P0 |
| [ ] | `DEFAULT_CODE_LANGUAGE` | const | 'javascript' | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getDefaultCodeLanguage` | fn | returns DEFAULT_CODE_LANGUAGE | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getCodeLineDirection` | fn | Determines the visual writing direction of a code line. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getEndOfCodeInLine` | fn | last non-whitespace caret position on a code line | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getFirstCodeNodeOfLine` | fn | first highlight/tab node after the previous line break | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getLastCodeNodeOfLine` | fn | last highlight/tab node before the next line break | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getStartOfCodeInLine` | fn | first non-whitespace position on a code line | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$outdentLeadingSpaces` | fn | Strip up to `tabSize` leading spaces from a {@link CodeHighlightNode} that starts a code line, to support outdenting space-indented code lines (e.g. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$plainifyCodeContent` | fn | Plain split of code text into CodeHighlightNodes (with no highlight type) + LineBreakNodes + TabNodes. | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/code-prism` (14 exports: 14 own, 0 re-exported; MODEL 12 / BRIDGE 1 / VIEW 1; P0 3 / P1 3 / P2 8; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `CodePrismConfig` | type | CodeHighlighterPrismExtension config (tokenizer) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodePrismExtension` | extension | Add code highlighting support for code blocks with Prism. | BRIDGE | no | lexical_rich_nodes + not-needed | P1 |
| [ ] | `PrismTokenizer` | const | Prism-based Tokenizer {defaultLanguage, tokenize} | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `registerCodeHighlighting` | fn | Register the Prism tokenizer-driven highlighting on the editor along with the indent / Tab / arrow-key keyboard handlers. | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `Tokenizer` | type | tokenizer interface {defaultLanguage, tokenize(code, lang) -> tokens} | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CODE_LANGUAGE_FRIENDLY_NAME_MAP` | const | language id -> display name | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CODE_LANGUAGE_MAP` | const | language alias -> canonical id (js->javascript, md->markdown...) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getCodeLanguageOptions` | fn | [id, friendlyName] pairs for UI | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getCodeLanguages` | fn | languages known to the tokenizer | MODEL | via `@lexical/code` | lexical_rich_nodes | P0 |
| [ ] | `getCodeThemeOptions` | fn | theme options for UI | VIEW | no | not-needed | P2 |
| [ ] | `getLanguageFriendlyName` | fn | friendly name for a language id | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `isCodeLanguageLoaded` | fn | language grammar is loaded | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `loadCodeLanguage` | fn | load a language grammar (async for shiki) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `normalizeCodeLanguage` | fn | map alias to canonical language id | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/code-shiki` (13 exports: 13 own, 0 re-exported; MODEL 9 / BRIDGE 2 / VIEW 2; P0 0 / P1 6 / P2 7; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `CodeHighlighterShikiConfig` | type | Shiki highlighter extension config | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodeHighlighterShikiExtension` | extension | extension: Shiki-based highlighting | BRIDGE | no | lexical_rich_nodes + not-needed | P2 |
| [ ] | `CodeShikiConfig` | type | Shiki tokenizer config | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CodeShikiExtension` | extension | Add code highlighting support for code blocks with Shiki. | BRIDGE | no | lexical_rich_nodes + not-needed | P1 |
| [ ] | `registerCodeHighlighting` | fn | Register the Shiki tokenizer-driven highlighting on the editor along with the indent / Tab / arrow-key keyboard handlers. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `ShikiTokenizer` | const | Shiki-based Tokenizer (emits style-carrying tokens) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `Tokenizer` | type | tokenizer interface {defaultLanguage, tokenize(code, lang) -> tokens} | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getCodeLanguageOptions` | fn | [id, friendlyName] pairs for UI | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getCodeThemeOptions` | fn | theme options for UI | VIEW | no | not-needed | P2 |
| [ ] | `isCodeLanguageLoaded` | fn | language grammar is loaded | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `loadCodeLanguage` | fn | load a language grammar (async for shiki) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `loadCodeTheme` | fn | load a Shiki theme (async) | VIEW | no | not-needed | P1 |
| [ ] | `normalizeCodeLanguage` | fn | map alias to canonical language id | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/devtools-core` (7 exports: 7 own, 0 re-exported; MODEL 2 / BRIDGE 0 / VIEW 5; P0 0 / P1 1 / P2 6; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `generateContent` | fn | print the editor tree (nodes, selection, formats) as text for TreeView/tests | MODEL | no | not-needed | P2 |
| [ ] | `CustomPrintNodeFn` | type | custom per-node printer for generateContent | VIEW | no | not-needed | P2 |
| [ ] | `TreeView` | const | React tree-view debug component | VIEW | no | not-needed | P1 |
| [ ] | `registerLexicalCommandLogger` | fn | log every dispatched command | MODEL | no | not-needed | P2 |
| [ ] | `useLexicalCommandsLog` | fn | React hook returning command log | VIEW | no | not-needed | P2 |
| [ ] | `LexicalCommandEntry` | type | logged command entry | VIEW | no | not-needed | P2 |
| [ ] | `LexicalCommandLog` | type | array of LexicalCommandEntry | VIEW | no | not-needed | P2 |

### `@lexical/dragon` (3 exports: 3 own, 0 re-exported; MODEL 0 / BRIDGE 0 / VIEW 3; P0 0 / P1 0 / P2 3; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `registerDragonSupport` | fn | Dragon NaturallySpeaking postMessage bridge: applies dictation text edits | VIEW | no | not-needed | P2 |
| [ ] | `DragonConfig` | type | DragonExtension config | VIEW | no | not-needed | P2 |
| [ ] | `DragonExtension` | extension | Add Dragon speech to text input support to the editor, via the \@lexical/dragon module. | VIEW | no | not-needed | P2 |

### `@lexical/extension` (79 exports: 58 own, 21 re-exported; MODEL 64 / BRIDGE 12 / VIEW 3; P0 0 / P1 26 / P2 53; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `AutoFocusConfig` | type | AutoFocusExtension config: defaultSelection, disabled | VIEW | no | not-needed | P2 |
| [ ] | `AutoFocusExtension` | extension | An Extension to focus the LexicalEditor when the root element is set (typically only when the editor is first created). | VIEW | no | not-needed | P1 |
| [ ] | `ClearEditorConfig` | type | ClearEditorExtension config: $onClear | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ClearEditorExtension` | extension | An extension to provide an implementation of {@link CLEAR_EDITOR_COMMAND} | BRIDGE | no | lexical_rich_nodes + not-needed | P2 |
| [ ] | `registerClearEditor` | fn | handle CLEAR_EDITOR_COMMAND: clear root to one empty paragraph | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$defaultShouldInsertAfter` | fn | default predicate: insert paragraph after last block if it is a decorator/table etc. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ClickAfterLastBlockConfig` | type | ClickAfterLastBlockExtension config: $shouldInsertAfter | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ClickAfterLastBlockExtension` | extension | Click handling for the empty area below the last block of the document. | BRIDGE | no | lexical_rich_nodes + web-view | P1 |
| [ ] | `ClickAfterLastBlockOutput` | type | ClickAfterLastBlockExtension output | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `getKnownTypesAndNodes` | fn | Get the sets of nodes and types registered in the {@link InitialEditorConfig}. | MODEL | no | lexical_model | P2 |
| [ ] | `KnownTypesAndNodes` | type | registered node types/classes available to config resolution | MODEL | no | lexical_model | P2 |
| [ ] | `$isDecoratorTextNode` | fn | type guard for DecoratorTextNode | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `applyFormatFromStyle` | fn | Applies formatting to the node based on the properties in the passed style object. | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `applyFormatToDom` | fn | The function wraps the passed DOM node in semantic tags depending on the node format. | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `DecoratorTextExtension` | extension | An extension for DecoratorTextNode that sets the format for the node and CSS classes for the DOM container. | BRIDGE | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `DecoratorTextNode` | class | inline decorator node carrying text format (DecoratorTextExtension) | BRIDGE | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `SerializedDecoratorTextNode` | type | JSON shape of DecoratorTextNode | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `EditorStateExtension` | extension | An extension to provide the current EditorState as a signal | BRIDGE | no | not-needed | P2 |
| [ ] | `$getExtensionDependency` | fn | Get the finalized config and output for `extension` from the editor currently in scope. | MODEL | no | lexical_model | P2 |
| [ ] | `$getExtensionOutput` | fn | Shorthand for `$getExtensionDependency(extension).output` — the most common reason to look up an extension dependency. | MODEL | no | lexical_model | P2 |
| [ ] | `$getPeerDependency` | fn | Get the finalized config and output for an optional peer extension by name, from the editor currently in scope. | MODEL | no | lexical_model | P2 |
| [ ] | `getExtensionDependencyFromEditor` | fn | Get the finalized config and output of an Extension that was used to build the editor. | MODEL | no | lexical_model | P1 |
| [ ] | `getPeerDependencyFromEditor` | fn | Get the finalized config and output of an Extension that was used to build the editor by name. | MODEL | no | lexical_model | P2 |
| [ ] | `getPeerDependencyFromEditorOrThrow` | fn | Get the finalized config and output of an Extension that was used to build the editor by name. | MODEL | no | lexical_model | P2 |
| [ ] | `$createHorizontalRuleNode` | fn | factory for HorizontalRuleNode (applies node replacement) | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `$isHorizontalRuleNode` | fn | type guard for HorizontalRuleNode | MODEL | no | not-needed (S3 §1a.17) | P1 |
| [ ] | `HorizontalRuleExtension` | extension | An extension for HorizontalRuleNode that provides an implementation that works without any React dependency. | BRIDGE | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `HorizontalRuleNode` | class | block decorator <hr> node | BRIDGE | no | not-needed (S3 §1a.17) | P1 |
| [ ] | `INSERT_HORIZONTAL_RULE_COMMAND` | command | command: insert horizontal rule | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `SerializedHorizontalRuleNode` | type | JSON shape of HorizontalRuleNode | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `InitialStateConfig` | type | InitialStateExtension config: updateOptions, setOptions | MODEL | no | lexical_model | P2 |
| [ ] | `InitialStateExtension` | extension | An extension to set the initial state of the editor from a function or serialized JSON EditorState. | BRIDGE | no | lexical_model + not-needed | P1 |
| [ ] | `buildEditorFromExtensions` | fn | Build a LexicalEditor by combining together one or more extensions, optionally overriding some of their configuration. | MODEL | no | lexical_model | P1 |
| [ ] | `LexicalBuilder` | class | builds an editor from an extension graph (dedupe, order, merge config, lifecycle) | MODEL | no | lexical_model | P1 |
| [ ] | `namedSignals` | fn | Return an object with the same shape as `defaults` with a {@link Signal } for each value. | MODEL | no | shim-only | P2 |
| [ ] | `NamedSignalsOptions` | type | defaults for namedSignals | MODEL | no | shim-only | P2 |
| [ ] | `NamedSignalsOutput` | type | object of signals produced by namedSignals | MODEL | no | shim-only | P2 |
| [ ] | `NestedEditorExtension` | extension | extension for nested editors inheriting parent config/theme | BRIDGE | no | not-needed | P1 |
| [ ] | `NodeSelectionExtension` | extension | An extension that provides a `watchNodeKey` output that returns a signal for the selection state of a node. | BRIDGE | no | lexical_model + not-needed | P2 |
| [ ] | `NormalizeInlineElementsConfig` | type | NormalizeInlineElementsExtension config | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `NormalizeInlineElementsExtension` | extension | This extension removes empty inline nodes from the EditorState. | BRIDGE | no | not-needed (S3 §1a.17) | P1 |
| [ ] | `NormalizeTripleClickSelectionConfig` | type | NormalizeTripleClickSelectionExtension config | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `NormalizeTripleClickSelectionExtension` | extension | This extension handles triple-click events and will move the focus towards the anchor in certain conditions to meet expectations. | BRIDGE | no | lexical_model + lexical_rich_nodes + web-view | P2 |
| [ ] | `NormalizeTripleClickSelectionOutput` | type | NormalizeTripleClickSelectionExtension output | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `SelectionAlwaysOnDisplayExtension` | extension | An extension that highlights selected content in the Lexical editor even when the editor is not currently focused. | VIEW | no | not-needed | P2 |
| [ ] | `batch` | fn | re-export from @preact/signals-core | MODEL | no | shim-only | P1 |
| [ ] | `computed` | fn | re-export from @preact/signals-core | MODEL | no | shim-only | P1 |
| [ ] | `effect` | fn | re-export from @preact/signals-core | MODEL | no | shim-only | P1 |
| [ ] | `ReadonlySignal` | type | re-export from @preact/signals-core | MODEL | no | shim-only | P2 |
| [ ] | `Signal` | class | re-export from @preact/signals-core | MODEL | no | shim-only | P2 |
| [ ] | `signal` | fn | re-export from @preact/signals-core | MODEL | no | shim-only | P1 |
| [ ] | `SignalOptions` | type | re-export from @preact/signals-core | MODEL | no | shim-only | P2 |
| [ ] | `untracked` | fn | re-export from @preact/signals-core | MODEL | no | shim-only | P2 |
| [ ] | `CanIndentPredicate` | type | predicate deciding whether a node may be indented by Tab | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `registerTabIndentation` | fn | Tab/Shift+Tab -> INDENT/OUTDENT_CONTENT (or INSERT_TAB), maxIndent | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `TabIndentationConfig` | type | TabIndentationExtension config: maxIndent, $canIndent | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `TabIndentationExtension` | extension | This extension adds the ability to indent content using the tab key. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `watchedSignal` | fn | Create a Signal that will subscribe to a value from an external store when watched, similar to React's [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore). | MODEL | no | shim-only | P2 |
| [ ] | `AnyLexicalExtension` | type | re-export of `lexical` | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `AnyLexicalExtensionArgument` | type | re-export of `lexical` | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `configExtension` | fn | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `declarePeerDependency` | fn | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `defineExtension` | fn | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `ExtensionConfigBase` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `ExtensionRegisterState` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `InitialEditorStateType` | type | re-export of `lexical` | MODEL | no | shim-only (TS type) | P1 |
| [ ] | `LexicalEditorWithDispose` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `LexicalExtension` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `LexicalExtensionArgument` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionConfig` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionDependency` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `LexicalExtensionInit` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionName` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `LexicalExtensionOutput` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `NormalizedLexicalExtensionArgument` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `NormalizedPeerDependency` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `OutputComponentExtension` | type | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |
| [ ] | `safeCast` | fn | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P1 |
| [ ] | `shallowMergeConfig` | fn | re-export of `lexical` | MODEL | no | lexical_model (registry) + shim | P2 |

### `@lexical/file` (5 exports: 5 own, 0 re-exported; MODEL 3 / BRIDGE 0 / VIEW 2; P0 0 / P1 0 / P2 5; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `editorStateFromSerializedDocument` | fn | Parse an EditorState from the given editor and document | MODEL | no | lexical_model | P2 |
| [ ] | `exportFile` | fn | Generates a .lexical file to be downloaded by the browser containing the current editor state. | VIEW | no | not-needed | P2 |
| [ ] | `importFile` | fn | Takes a file and inputs its content into the editor state as an input field. | VIEW | no | not-needed | P2 |
| [ ] | `SerializedDocument` | type | JSON shape of Document | MODEL | no | lexical_model | P2 |
| [ ] | `serializedDocumentFromEditorState` | fn | Generates a SerializedDocument from the given EditorState | MODEL | no | lexical_model | P2 |

### `@lexical/hashtag` (6 exports: 6 own, 0 re-exported; MODEL 4 / BRIDGE 2 / VIEW 0; P0 0 / P1 2 / P2 4; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `HashtagConfig` | type | HashtagExtension config | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `HashtagExtension` | extension | Add `#hashtag` support to the editor | BRIDGE | no | lexical_rich_nodes + shim | P2 |
| [ ] | `registerLexicalHashtag` | fn | register hashtag text-entity transforms (see §3B.3.1) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createHashtagNode` | fn | Generates a HashtagNode, which is a string following the format of a # followed by some text, eg. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$isHashtagNode` | fn | Determines if node is a HashtagNode. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `HashtagNode` | class | TextNode subclass for #tags (token-ish, created/removed by text entity transform) | BRIDGE | no | lexical_rich_nodes + shim | P1 |

### `@lexical/headless` (2 exports: 2 own, 0 re-exported; MODEL 1 / BRIDGE 0 / VIEW 1; P0 1 / P1 1 / P2 0; imported by Macro: 1)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `createHeadlessEditor` | fn | Generates a headless editor that allows lexical to be used without the need for a DOM, eg in Node.js. | MODEL | yes (26 files) | lexical_model | P0 |

Entry point `@lexical/headless/dom`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `withDOM` | fn | Call the given synchronous function with a window object, either from the browser or happy-dom in a non-browser environment. | VIEW | no | not-needed | P1 |

### `@lexical/history` (9 exports: 9 own, 0 re-exported; MODEL 7 / BRIDGE 2 / VIEW 0; P0 2 / P1 3 / P2 4; imported by Macro: 2)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `registerHistory` | fn | Registers necessary listeners to manage undo/redo history stack and related editor commands. | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `createEmptyHistoryState` | fn | Creates an empty history state. | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `HistoryStateEntry` | type | {editor, editorState} undo stack entry | MODEL | no | lexical_model | P2 |
| [ ] | `HistoryState` | type | {current, undoStack, redoStack} | MODEL | no | lexical_model | P1 |
| [ ] | `HistoryConfig` | type | HistoryExtension config: delay, createInitialHistoryState, disabled | MODEL | no | lexical_model | P2 |
| [ ] | `HistoryExtensionOutput` | type | The output signals exposed by {@link HistoryExtension}. | MODEL | no | lexical_model | P2 |
| [ ] | `HistoryExtension` | extension | Registers necessary listeners to manage undo/redo history stack and related editor commands, via the \@lexical/history module. | BRIDGE | no | lexical_model + shim | P1 |
| [ ] | `SharedHistoryConfig` | type | SharedHistoryExtension config (parent editor) | MODEL | no | lexical_model | P2 |
| [ ] | `SharedHistoryExtension` | extension | Registers necessary listeners to manage undo/redo history stack and related editor commands, via the \@lexical/history module, only if the parent editor has a history plugin implementation. | BRIDGE | no | lexical_model + shim | P1 |

### `@lexical/html` (83 exports: 83 own, 0 re-exported; MODEL 0 / BRIDGE 83 / VIEW 0; P0 2 / P1 34 / P2 47; imported by Macro: 2)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$generateNodesFromDOM` | fn | How you parse your html string to get a document is left up to you. | BRIDGE | yes (8 files) | web-view | P0 |
| [ ] | `$generateDOMFromNodes` | fn | Generate DOM nodes from the editor state into the given container element, using the editor's {@link EditorDOMRenderConfig}. | BRIDGE | no | lexical_html | P2 |
| [ ] | `$generateDOMFromRoot` | fn | Generate DOM nodes from a root node into the given container element, including the root node itself. | BRIDGE | no | lexical_html | P1 |
| [ ] | `$generateHtmlFromNodes` | fn | Generate an HTML string from the editor's current state (or `selection` if provided). | BRIDGE | yes (7 files) | lexical_html | P0 |
| [ ] | `contextUpdater` | fn | Create a context config updater that transforms a value in the render context. | BRIDGE | no | lexical_html | P2 |
| [ ] | `contextValue` | fn | Create a context config pair that sets a value in the render context. | BRIDGE | no | lexical_html | P1 |
| [ ] | `domOverride` | fn | A convenience function for type inference when constructing DOM overrides for use with {@link DOMRenderExtension }. | BRIDGE | no | lexical_html | P1 |
| [ ] | `DOMRenderExtension` | extension | experimental: override createDOM/exportDOM per node match | BRIDGE | no | lexical_html | P1 |
| [ ] | `AnyDOMImportRule` | type | erased DOM import rule type | BRIDGE | no | shim-only (TS type) | P1 |
| [ ] | `AttrMatchOptions` | type | Options bag for {@link ElementSelectorBuilder.attr} when the value is a regex. | BRIDGE | no | not-needed | P2 |
| [ ] | `CapturesOfSelector` | type | The named-capture map for a selector. | BRIDGE | no | not-needed | P2 |
| [ ] | `ChildSchema` | type | A {@link ChildSchema} encodes which lexical nodes a parent accepts as children and how to package or reject the rest. | BRIDGE | no | not-needed | P2 |
| [ ] | `CompiledOverlayRules` | type | Opaque handle for a pre-compiled set of overlay rules. | BRIDGE | no | not-needed | P2 |
| [ ] | `CompiledSelector` | type | An opaque, compiled selector used as the `match` field of a {@link DOMImportRule}. | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMImportContext` | type | Context exposed to a rule's `$import` function. | BRIDGE | no | not-needed | P1 |
| [ ] | `DOMImportExtensionOutput` | type | Output of {@link DOMImportExtension }. | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMImportFn` | type | The middleware signature of an import rule. | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMImportRule` | type | An importer for a DOM node, dispatched by `match` and implemented by `$import`. | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMImportRuleEntry` | type | An entry accepted everywhere rules are configured (overlay definitions, {@link DOMImportConfig.rules }). | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMPreprocessContext` | type | Context exposed to a {@link DOMPreprocessFn}. | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMPreprocessFn` | type | A middleware step in the DOM-preprocess chain. | BRIDGE | no | not-needed | P1 |
| [ ] | `ElementSelectorBuilder` | type | Fluent builder for an element selector. | BRIDGE | no | not-needed | P2 |
| [ ] | `GenerateNodesFromDOMOptions` | type | Per-call options to the extension's `$generateNodesFromDOM`. | BRIDGE | no | not-needed | P1 |
| [ ] | `ImportChildrenOpts` | type | Options accepted by {@link DOMImportContext.$importChildren}. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportContextPairOrUpdater` | type | Argument to {@link DOMImportContext.branch } / `$importChildren({context})` — see {@link ContextConfigPair } / {@link ContextConfigUpdater }. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportNodeOpts` | type | options for DOM import of a node | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportSession` | type | A mutable, document-order-shared store for the import pipeline. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportStateConfig` | type | A typed context-state key for the import pipeline. | BRIDGE | no | not-needed | P2 |
| [ ] | `NodeOfSelector` | type | The Node subtype matched by a selector (e.g. | BRIDGE | no | not-needed | P2 |
| [ ] | `StyleMatchOptions` | type | Options bag for {@link ElementSelectorBuilder.styleAny} when the value is a regex. | BRIDGE | no | not-needed | P2 |
| [ ] | `$distributeInlineWrapper` | fn | Distribute an inline wrapper (`LinkNode`, `MarkNode`, …) across a heterogeneous run of children produced by `$importChildren`, lifting any block children to the top level while keeping the wrapper around the leaf inline  | BRIDGE | no | not-needed | P2 |
| [ ] | `$generateNodesFromDOMViaExtension` | fn | Look up the editor's {@link DOMImportExtension} and run its `$generateNodesFromDOM`. | BRIDGE | no | not-needed | P1 |
| [ ] | `$getImportContextValue` | fn | Read an import context value during an import operation. | BRIDGE | no | not-needed | P1 |
| [ ] | `$inlineStylesFromStyleSheets` | fn | Inlines CSS rules from `<style>` tags onto matching elements as inline styles. | BRIDGE | no | not-needed | P1 |
| [ ] | `$isBlockLevel` | fn | True if the node fills a block slot at the root or inside another block — covers both ElementNode-style blocks (paragraph, heading, quote) and block-level DecoratorNodes (HorizontalRuleNode, ImageNode-as-block, etc.). | BRIDGE | no | not-needed | P2 |
| [ ] | `$withImportContext` | const | Run `f` with the given context pairs applied on top of the editor's current import context. | BRIDGE | no | not-needed | P2 |
| [ ] | `BlockSchema` | const | Default schema for block-level positions (root of the document, the body of a block element node). | BRIDGE | no | not-needed | P1 |
| [ ] | `CoreImportExtension` | extension | Bundles {@link CoreImportRules} into a {@link DOMImportExtension}-aware extension. | BRIDGE | no | not-needed | P1 |
| [ ] | `CoreImportRules` | const | Rules covering the {@link ParagraphNode }, {@link TextNode }, {@link LineBreakNode }, and {@link TabNode } cases that the legacy `importDOM` machinery in `@lexical/lexical` handled. | BRIDGE | no | not-needed | P2 |
| [ ] | `createImportState` | fn | Create an import context state. | BRIDGE | no | not-needed | P1 |
| [ ] | `defaultIsInline` | fn | Default {@link WhitespaceImportConfig.isInline}: treats an element as inline iff its inline `display` style is `inline*` OR (no explicit non-inline display) its nodeName is a known inline tag (`isInlineDomNode`). | BRIDGE | no | not-needed | P1 |
| [ ] | `defaultPreservesWhitespace` | fn | Default {@link WhitespaceImportConfig.preservesWhitespace}: matches `<pre>` and any element with `white-space: pre*`. | BRIDGE | no | not-needed | P1 |
| [ ] | `defineImportRule` | fn | Identity helper that infers a rule's matched node type and capture map from its `match` selector and threads them into the `$import` signature. | BRIDGE | no | not-needed | P1 |
| [ ] | `defineOverlayRules` | fn | Pre-compile a set of {@link DOMImportRuleEntry}s into a {@link CompiledOverlayRules} handle that can be installed via `ctx.$importChildren(el, {rules: …})`. | BRIDGE | no | not-needed | P1 |
| [ ] | `DOMImportConfig` | type | Configuration for {@link DOMImportExtension}. | BRIDGE | no | not-needed | P2 |
| [ ] | `DOMImportExtension` | extension | experimental: rule-based HTML importer extension | BRIDGE | no | not-needed | P1 |
| [ ] | `HorizontalRuleImportExtension` | extension | Bundles {@link HorizontalRuleImportRules} (plus {@link CoreImportExtension}) into a single dependency. | BRIDGE | no | not-needed | P1 |
| [ ] | `HorizontalRuleImportRules` | const | Import rules for {@link HorizontalRuleNode }. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportOverlays` | const | Built-in session slot for runtime overlay rules that should be in effect for the entire walk. | BRIDGE | no | not-needed | P1 |
| [ ] | `ImportSource` | const | Built-in import-context state identifying how this import was initiated. | BRIDGE | no | not-needed | P1 |
| [ ] | `ImportSourceDataTransfer` | const | Built-in import-context state holding the {@link DataTransfer} the import was sourced from, if any. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportSourceKind` | type | The kind of operation that produced this import. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportTextFormat` | const | Built-in import-context state holding the bit-packed {@link TextFormatType } formats that should apply to {@link TextNode }s produced during the current subtree. | BRIDGE | no | not-needed | P1 |
| [ ] | `ImportTextStyle` | const | Built-in import-context state holding a parsed CSS-style record (the {@link getStyleObjectFromCSS } shape) that should apply to {@link TextNode }s produced during the current subtree. | BRIDGE | no | not-needed | P2 |
| [ ] | `ImportWhitespaceConfig` | const | Built-in import-context state controlling text-node whitespace handling (collapse vs. | BRIDGE | no | not-needed | P1 |
| [ ] | `InlineSchema` | const | Schema for inline-only positions (the body of an inline lexical node such as a link). | BRIDGE | no | not-needed | P1 |
| [ ] | `isElementOfTag` | fn | Cross-frame-safe replacement for `node instanceof HTMLXxxElement`. | BRIDGE | no | not-needed | P1 |
| [ ] | `IsInlineForWhitespace` | type | Determines whether a given DOM node sits on the same visual line as its adjacent text siblings, governing whether leading/trailing whitespace in a `#text` is collapsed against neighbors. | BRIDGE | no | not-needed | P2 |
| [ ] | `IsPreserveWhitespaceDom` | type | Determines whether a given DOM element should be treated as preserving whitespace (i.e. | BRIDGE | no | not-needed | P2 |
| [ ] | `NestedBlockSchema` | const | Schema for nested block positions — the equivalent of the legacy `ArtificialNode__DO_NOT_USE` flow used when a block DOM element appears inside another block lexical ancestor. | BRIDGE | no | not-needed | P2 |
| [ ] | `parseSelector` | fn | Parse a reduced CSS-selector subset and return a {@link CompiledSelector }. | BRIDGE | no | not-needed | P1 |
| [ ] | `RootSchema` | const | Schema for the topmost level of `$generateNodesFromDOM`. | BRIDGE | no | not-needed | P1 |
| [ ] | `sel` | const | Combinator-and-parser-based builder for {@link CompiledSelector }s. | BRIDGE | no | not-needed | P1 |
| [ ] | `WhitespaceImportConfig` | type | Configuration for the core text whitespace-collapse logic. | BRIDGE | no | not-needed | P2 |
| [ ] | `$getRenderContextValue` | fn | Get a render context value during a DOM render or export operation. | BRIDGE | no | lexical_html | P1 |
| [ ] | `$getSessionDOMRenderConfig` | fn | Resolve the {@link EditorDOMRenderConfig} to use for the current export/generate session, applying any `disabledForSession` overrides against the active session context. | BRIDGE | no | lexical_html | P2 |
| [ ] | `$setRenderContextValue` | fn | Imperatively set a value in the persistent editor render context. | BRIDGE | no | lexical_html | P1 |
| [ ] | `$updateRenderContextValue` | fn | Imperatively update a value in the persistent editor render context with an updater function. | BRIDGE | no | lexical_html | P2 |
| [ ] | `$withRenderContext` | const | Execute a callback within a render context with the given config pairs. | BRIDGE | no | lexical_html | P1 |
| [ ] | `createRenderState` | fn | Create a context state to be used during render. | BRIDGE | no | lexical_html | P1 |
| [ ] | `RenderContextExport` | const | Render context state that is true if this is an export operation ($generateHtmlFromNodes). | BRIDGE | no | lexical_html | P2 |
| [ ] | `RenderContextRoot` | const | Render context state that is true if the export was initiated from the root of the document. | BRIDGE | no | lexical_html | P1 |
| [ ] | `AnyDOMRenderMatch` | type | erased DOMRenderMatch | BRIDGE | no | shim-only (TS type) | P2 |
| [ ] | `AnyRenderStateConfig` | type | erased render-context state config | BRIDGE | no | shim-only (TS type) | P2 |
| [ ] | `AnyRenderStateConfigPairOrUpdater` | type | erased render-context pair/updater | BRIDGE | no | shim-only (TS type) | P2 |
| [ ] | `ContextPairOrUpdater` | type | set or update a render-context value | BRIDGE | no | lexical_html | P2 |
| [ ] | `DOMOverrideOptions` | type | options for a DOM render override | BRIDGE | no | lexical_html | P2 |
| [ ] | `DOMRenderConfig` | type | DOMRenderExtension config: overrides, contextDefaults | BRIDGE | no | lexical_html | P2 |
| [ ] | `DOMRenderExtensionOutput` | type | DOMRenderExtension output | BRIDGE | no | lexical_html | P2 |
| [ ] | `DOMRenderMatch` | type | node match + overridden DOM hooks | BRIDGE | no | lexical_html | P2 |
| [ ] | `DOMRenderMatchConfig` | type | config for one DOMRenderMatch | BRIDGE | no | lexical_html | P2 |
| [ ] | `NodeMatch` | type | node class or guard used to match nodes | BRIDGE | no | lexical_html | P2 |
| [ ] | `RenderContextReader` | type | accessor for render-context values | BRIDGE | no | lexical_html | P2 |

### `@lexical/link` (27 exports: 27 own, 0 re-exported; MODEL 19 / BRIDGE 5 / VIEW 3; P0 7 / P1 8 / P2 12; imported by Macro: 7)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ClickableLinkConfig` | type | ClickableLinkExtension config: newTab, disabled | VIEW | no | not-needed | P2 |
| [ ] | `ClickableLinkExtension` | extension | Normally in a Lexical editor the `CLICK_COMMAND` on a LinkNode will cause the selection to change instead of opening a link. | VIEW | no | not-needed | P2 |
| [ ] | `registerClickableLink` | fn | open links on click/middle-click (view) | VIEW | no | not-needed | P2 |
| [ ] | `AutoLinkConfig` | type | AutoLinkExtension config: matchers, changeHandlers, excludeParents | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `AutoLinkExtension` | extension | An extension to automatically create AutoLinkNode from text that matches the configured matchers. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `ChangeHandler` | type | callback(url, prevUrl) on auto-link change | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `createLinkMatcherWithRegExp` | fn | build a LinkMatcher from a regex + url transform | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `LinkMatcher` | type | fn(text) -> {index, length, text, url, attributes} \| null | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `registerAutoLink` | fn | auto-link transforms on TextNode/AutoLinkNode (see §3B.2.6) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `LinkExtension` | extension | Provides {@link LinkNode}, an implementation of {@link TOGGLE_LINK_COMMAND}, and a {@link PASTE_COMMAND} listener to wrap selected nodes in a link when a URL is pasted and `validateUrl` is defined. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `registerLink` | fn | register TOGGLE_LINK_COMMAND + paste-URL handlers (see §3B.2.5) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createAutoLinkNode` | fn | Takes a URL and creates an AutoLinkNode. | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$createLinkNode` | fn | Takes a URL and creates a LinkNode. | MODEL | yes (10 files) | lexical_rich_nodes | P0 |
| [ ] | `$isAutoLinkNode` | fn | Determines if node is an AutoLinkNode. | MODEL | yes (5 files) | lexical_rich_nodes | P0 |
| [ ] | `$isLinkNode` | fn | Determines if node is a LinkNode. | MODEL | yes (10 files) | lexical_rich_nodes | P0 |
| [ ] | `$toggleLink` | fn | Generates or updates a LinkNode. | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `AutoLinkAttributes` | type | LinkAttributes minus title + isUnlinked | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `AutoLinkNode` | class | LinkNode created by auto-link matchers; isUnlinked flag | BRIDGE | yes (2 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `formatUrl` | fn | Formats a URL string by adding appropriate protocol if missing | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `LinkAttributes` | type | {rel, target, title} | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `LinkNode` | class | inline link element: url (sanitized), rel, target, title | BRIDGE | yes (10 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `SerializedAutoLinkNode` | type | JSON shape of AutoLinkNode | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `SerializedLinkNode` | type | JSON shape of LinkNode | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `TOGGLE_LINK_COMMAND` | command | command: toggle link | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `LinkImportExtension` | extension | Bundles {@link LinkImportRules} (plus {@link CoreImportExtension}) into a single dependency. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `LinkImportRules` | const | Import rules for {@link LinkNode }. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `toggleLink` | const | deprecated alias of $toggleLink | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/list` (32 exports: 32 own, 0 re-exported; MODEL 26 / BRIDGE 6 / VIEW 0; P0 14 / P1 7 / P2 11; imported by Macro: 14)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `insertList` | fn | deprecated: editor.update($insertList) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `removeList` | fn | deprecated: editor.update($removeList) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CheckListConfig` | type | CheckListExtension config: disableTakeFocusOnClick | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `CheckListExtension` | extension | Registers checklist functionality for {@link ListNode} and {@link ListItemNode} with a `INSERT_CHECK_LIST_COMMAND` listener and the expected keyboard and mouse interactions for checkboxes. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `ListConfig` | type | ListExtension config: hasStrictIndent, shouldPreserveNumbering | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ListExtension` | extension | Configures {@link ListNode}, {@link ListItemNode} and registers the strict indent transform if `hasStrictIndent` is true (default false). | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `ListImportExtension` | extension | Bundles {@link ListImportRules} (plus {@link CoreImportExtension}) into a single dependency. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `ListImportRules` | const | Import rules for {@link ListNode } and {@link ListItemNode}, including GitHub task-list and Joplin checkbox heuristics. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `ListSchema` | const | A {@link ChildSchema} that enforces ListNode invariants: only `ListItemNode` and (immediately-nested) `ListNode` children are accepted; runs of other children get wrapped in a fresh `ListItemNode`. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `INSERT_ORDERED_LIST_COMMAND` | command | command: insert ordered list | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `INSERT_UNORDERED_LIST_COMMAND` | command | command: insert unordered list | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `registerList` | fn | register list commands + transforms (see §3C) | MODEL | yes (5 files) | lexical_rich_nodes | P0 |
| [ ] | `RegisterListOptions` | type | options for registerList (restoreNumbering) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `registerListStrictIndentTransform` | fn | transform forbidding indent deeper than previous item + 1 | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `REMOVE_LIST_COMMAND` | command | command: remove list | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `UPDATE_LIST_START_COMMAND` | command | command: update list start | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createListItemNode` | fn | Creates a new List Item node, passing true/false will convert it to a checkbox input. | MODEL | yes (16 files) | lexical_rich_nodes | P0 |
| [ ] | `$createListNode` | fn | Creates a ListNode of listType. | MODEL | yes (19 files) | lexical_rich_nodes | P0 |
| [ ] | `$getListDepth` | fn | Checks the depth of listNode from the root node. | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `$handleListInsertParagraph` | fn | Attempts to insert a ParagraphNode at selection and selects the new node. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$insertList` | fn | Inserts a new ListNode. | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `$isListItemNode` | fn | Checks to see if the node is a ListItemNode. | MODEL | yes (28 files) | lexical_rich_nodes | P0 |
| [ ] | `$isListNode` | fn | Checks to see if the node is a ListNode. | MODEL | yes (26 files) | lexical_rich_nodes | P0 |
| [ ] | `$removeList` | fn | Searches for the nearest ancestral ListNode and removes it. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `INSERT_CHECK_LIST_COMMAND` | command | command: insert check list | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `ListItemNode` | class | list item: value, checked; nested lists live in a child-only ListItem | BRIDGE | yes (24 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `ListNode` | class | list element: listType, start, tag ul/ol | BRIDGE | yes (21 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `ListNodeTagType` | type | 'ul' \| 'ol' | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `ListType` | type | 'number' \| 'bullet' \| 'check' | MODEL | yes (5 files) | shim-only (TS type) | P0 |
| [ ] | `registerCheckList` | fn | Registers the checklist plugin with the editor. | BRIDGE | no | lexical_rich_nodes + shim | P2 |
| [ ] | `SerializedListItemNode` | type | JSON shape of ListItemNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `SerializedListNode` | type | JSON shape of ListNode | MODEL | yes (1 files) | lexical_rich_nodes | P0 |

### `@lexical/mark` (8 exports: 8 own, 0 re-exported; MODEL 6 / BRIDGE 2 / VIEW 0; P0 7 / P1 0 / P2 1; imported by Macro: 7)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$unwrapMarkNode` | fn | replace a MarkNode with its children | MODEL | yes (4 files) | lexical_rich_nodes | P0 |
| [ ] | `$wrapSelectionInMarkNode` | fn | wrap the selection in MarkNode(s) with an id (splitting at block edges) | MODEL | yes (4 files) | lexical_rich_nodes | P0 |
| [ ] | `$getMarkIDs` | fn | mark ids covering a text node offset | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `MarkExtension` | extension | Configures {@link MarkNode} | BRIDGE | no | lexical_rich_nodes + shim | P2 |
| [ ] | `$createMarkNode` | fn | factory for MarkNode (applies node replacement) | MODEL | yes (4 files) | lexical_rich_nodes | P0 |
| [ ] | `$isMarkNode` | fn | type guard for MarkNode | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `MarkNode` | class | inline element carrying a set of ids (comments); overlapping marks nest | BRIDGE | yes (5 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `SerializedMarkNode` | type | JSON shape of MarkNode | MODEL | yes (2 files) | lexical_rich_nodes | P0 |

### `@lexical/markdown` (30 exports: 30 own, 0 re-exported; MODEL 30 / BRIDGE 0 / VIEW 0; P0 15 / P1 2 / P2 13; imported by Macro: 15)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$convertFromMarkdownString` | fn | Renders markdown from a string. | MODEL | yes (38 files) | lexical_markdown | P0 |
| [ ] | `$convertSelectionToMarkdownString` | fn | Converts the selected content to a markdown string. | MODEL | yes (1 files) | lexical_markdown | P0 |
| [ ] | `$convertToMarkdownString` | fn | Renders string from markdown. | MODEL | yes (32 files) | lexical_markdown | P0 |
| [ ] | `BOLD_ITALIC_STAR` | const | text-format transformer *** -> bold+italic | MODEL | no | lexical_markdown | P2 |
| [ ] | `BOLD_ITALIC_UNDERSCORE` | const | text-format transformer ___ -> bold+italic (intraword off) | MODEL | no | lexical_markdown | P2 |
| [ ] | `BOLD_STAR` | const | text-format transformer ** -> bold | MODEL | no | lexical_markdown | P2 |
| [ ] | `BOLD_UNDERSCORE` | const | text-format transformer __ -> bold (intraword off) | MODEL | no | lexical_markdown | P2 |
| [ ] | `CHECK_LIST` | const | element transformer `- [ ]`/`- [x]` -> check list item | MODEL | yes (2 files) | lexical_markdown | P0 |
| [ ] | `CODE` | const | multiline element transformer ``` fenced code block (language after fence) | MODEL | yes (2 files) | lexical_markdown | P0 |
| [ ] | `ELEMENT_TRANSFORMERS` | const | [HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST] | MODEL | no | lexical_markdown | P2 |
| [ ] | `ElementTransformer` | type | block transformer: dependencies, export, regExp, replace, type 'element' | MODEL | yes (17 files) | lexical_markdown | P0 |
| [ ] | `HEADING` | const | element transformer `#`..`######` -> HeadingNode | MODEL | no | lexical_markdown | P1 |
| [ ] | `HIGHLIGHT` | const | text-format transformer == -> highlight | MODEL | no | lexical_markdown | P2 |
| [ ] | `INLINE_CODE` | const | text-format transformer ` -> code | MODEL | no | lexical_markdown | P2 |
| [ ] | `ITALIC_STAR` | const | text-format transformer * -> italic | MODEL | no | lexical_markdown | P2 |
| [ ] | `ITALIC_UNDERSCORE` | const | text-format transformer _ -> italic (intraword off) | MODEL | no | lexical_markdown | P2 |
| [ ] | `LINK` | const | text-match transformer [text](url "title") <-> LinkNode | MODEL | no | lexical_markdown | P1 |
| [ ] | `MULTILINE_ELEMENT_TRANSFORMERS` | const | [CODE] | MODEL | no | lexical_markdown | P2 |
| [ ] | `MultilineElementTransformer` | type | block transformer spanning lines: regExpStart/regExpEnd, handleImportAfterStartMatch, replace | MODEL | yes (5 files) | lexical_markdown | P0 |
| [ ] | `ORDERED_LIST` | const | element transformer `1.` -> numbered list (start honoured) | MODEL | yes (2 files) | lexical_markdown | P0 |
| [ ] | `QUOTE` | const | element transformer `>` -> QuoteNode (consecutive lines merge with line breaks) | MODEL | no | lexical_markdown | P2 |
| [ ] | `registerMarkdownShortcuts` | fn | live-typing markdown shortcuts on the editor (see §3B.1.7) | MODEL | yes (1 files) | lexical_markdown | P0 |
| [ ] | `STRIKETHROUGH` | const | text-format transformer ~~ -> strikethrough | MODEL | no | lexical_markdown | P2 |
| [ ] | `TEXT_FORMAT_TRANSFORMERS` | const | [INLINE_CODE, BOLD_ITALIC_STAR, BOLD_ITALIC_UNDERSCORE, BOLD_STAR, BOLD_UNDERSCORE, HIGHLIGHT, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH] | MODEL | yes (1 files) | lexical_markdown | P0 |
| [ ] | `TEXT_MATCH_TRANSFORMERS` | const | [LINK] | MODEL | no | lexical_markdown | P2 |
| [ ] | `TextFormatTransformer` | type | inline format transformer: format[], tag, intraword | MODEL | yes (1 files) | lexical_markdown | P0 |
| [ ] | `TextMatchTransformer` | type | inline match transformer: importRegExp, regExp, replace, export, trigger, getEndIndex | MODEL | yes (12 files) | lexical_markdown | P0 |
| [ ] | `Transformer` | type | union of the four transformer kinds | MODEL | yes (10 files) | lexical_markdown | P0 |
| [ ] | `TRANSFORMERS` | const | all built-in transformers in priority order | MODEL | yes (3 files) | lexical_markdown | P0 |
| [ ] | `UNORDERED_LIST` | const | element transformer `-`/`*`/`+` -> bullet list | MODEL | yes (1 files) | lexical_markdown | P0 |

### `@lexical/offset` (3 exports: 3 own, 0 re-exported; MODEL 3 / BRIDGE 0 / VIEW 0; P0 0 / P1 0 / P2 3; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$createOffsetView` | fn | factory for OffsetView (applies node replacement) | MODEL | no | lexical_model | P2 |
| [ ] | `OffsetView` | class | flattened offset index over the document for offset<->selection mapping | MODEL | no | lexical_model | P2 |
| [ ] | `$createChildrenArray` | const | factory for ChildrenArray (applies node replacement) | MODEL | no | lexical_model | P2 |

### `@lexical/overflow` (5 exports: 5 own, 0 re-exported; MODEL 3 / BRIDGE 2 / VIEW 0; P0 0 / P1 3 / P2 2; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$createOverflowNode` | fn | factory for OverflowNode (applies node replacement) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$isOverflowNode` | fn | type guard for OverflowNode | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `SerializedOverflowNode` | type | JSON shape of OverflowNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `OverflowNode` | class | inline element wrapping text past a character limit | BRIDGE | no | lexical_rich_nodes + not-needed | P1 |
| [ ] | `OverflowExtension` | extension | Configures {@link OverflowNode} | BRIDGE | no | lexical_rich_nodes + not-needed | P2 |

### `@lexical/plain-text` (2 exports: 2 own, 0 re-exported; MODEL 0 / BRIDGE 2 / VIEW 0; P0 1 / P1 1 / P2 0; imported by Macro: 1)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `registerPlainText` | fn | register plain-text default command handlers (see §3A.2) | BRIDGE | yes (2 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `PlainTextExtension` | extension | An extension to register \@lexical/plain-text behavior | BRIDGE | no | lexical_rich_nodes + shim | P1 |

### `@lexical/react` (129 exports: 120 own, 9 re-exported; MODEL 9 / BRIDGE 1 / VIEW 119; P0 1 / P1 55 / P2 73; imported by Macro: 0)


Entry point `@lexical/react/ExtensionComponent`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ExtensionComponent` | fn | A convenient way to get an Extension's output Component with {@link useExtensionComponent} and construct it in one step. | VIEW | no | not-needed | P1 |
| [ ] | `ExtensionComponentProps` | type | The lexical:extension prop combined with the props of the given Extension's output Component. | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalAutoEmbedPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalAutoEmbedPlugin` | fn | Watches for pasted AutoLink nodes that match any of the provided embed configurations (e.g., YouTube, Twitter URLs). | VIEW | no | not-needed | P2 |
| [ ] | `EmbedMatchResult` | type | {url, id, data} | VIEW | no | not-needed | P2 |
| [ ] | `EmbedConfig` | type | embed type config (parseUrl, insertNode) | VIEW | no | not-needed | P2 |
| [ ] | `URL_MATCHER` | const | regex for http(s) URLs in auto-embed | VIEW | no | not-needed | P1 |
| [ ] | `INSERT_EMBED_COMMAND` | command | command: insert embed | VIEW | no | not-needed | P2 |
| [ ] | `AutoEmbedOption` | class | auto-embed menu option | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalAutoFocusPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `AutoFocusPlugin` | fn | focus editor on mount | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalAutoLinkPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `AutoLinkPlugin` | fn | registerAutoLink | VIEW | no | not-needed | P2 |
| [ ] | `ChangeHandler` | type | re-export of `@lexical/link` | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `createLinkMatcherWithRegExp` | fn | re-export of `@lexical/link` | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `LinkMatcher` | type | re-export of `@lexical/link` | MODEL | no | lexical_rich_nodes | P2 |

Entry point `@lexical/react/LexicalBlockWithAlignableContents`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `BlockWithAlignableContents` | fn | decorator wrapper with alignment + selection | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalCharacterLimitPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `CharacterLimitPlugin` | fn | overflow past maxLength (OverflowNode) | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalCheckListPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `CheckListPlugin` | fn | registerCheckList | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalClearEditorPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ClearEditorPlugin` | fn | registerClearEditor | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalClickableLinkPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ClickableLinkPlugin` | fn | registerClickableLink | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalCollaborationContext`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalCollaboration` | fn | collab context provider | VIEW | no | not-needed | P1 |
| [ ] | `useCollaborationContext` | fn | hook | VIEW | no | not-needed | P1 |
| [ ] | `CollaborationContextType` | type | type | VIEW | no | not-needed | P2 |
| [ ] | `CollaborationContext` | const | context | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalCollaborationPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `CollaborationPlugin` | fn | Yjs collab plugin | VIEW | no | not-needed | P1 |
| [ ] | `CollaborationPluginV2__EXPERIMENTAL` | fn | Yjs v2 collab plugin | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalComposer`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalComposer` | fn | root React composer | VIEW | no | not-needed | P1 |
| [ ] | `InitialEditorStateType` | type | The initial editor state accepted by {@link LexicalComposer} via `initialConfig.editorState`. | VIEW | no | not-needed | P1 |
| [ ] | `InitialConfigType` | type | composer initialConfig | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalComposerContext`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `createLexicalComposerContext` | fn | create composer context | VIEW | no | not-needed | P1 |
| [ ] | `useLexicalComposerContext` | fn | hook: [editor, context] | VIEW | no | not-needed | P1 |
| [ ] | `LexicalComposerContextType` | type | type | VIEW | no | not-needed | P2 |
| [ ] | `LexicalComposerContextWithEditor` | type | type | VIEW | no | not-needed | P2 |
| [ ] | `LexicalComposerContext` | const | context | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalContentEditable`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ContentEditableElement` | const | contenteditable root element | VIEW | no | not-needed | P1 |
| [ ] | `ContentEditableElementProps` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `ContentEditableProps` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `Props` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `ContentEditable` | const | contenteditable + placeholder | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalDecoratorBlockNode`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$isDecoratorBlockNode` | fn | type guard for DecoratorBlockNode | VIEW | no | not-needed | P2 |
| [ ] | `SerializedDecoratorBlockNode` | type | JSON shape of DecoratorBlockNode | VIEW | no | not-needed | P2 |
| [ ] | `DecoratorBlockNode` | class | block decorator base with element format (alignment) | BRIDGE | no | not-needed | P2 |

Entry point `@lexical/react/LexicalDraggableBlockPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `DraggableBlockPlugin_EXPERIMENTAL` | fn | drag handle for moving blocks | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalEditorRefPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `EditorRefPlugin` | fn | Use this plugin to access the editor instance outside of the LexicalComposer. | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalErrorBoundary`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalErrorBoundary` | fn | React error boundary for decorators | VIEW | no | not-needed | P1 |
| [ ] | `LexicalErrorBoundaryProps` | type | props | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalExtensionComposer`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalExtensionComposer` | fn | The equivalent of LexicalComposer for an extension. | VIEW | no | not-needed | P1 |
| [ ] | `LexicalExtensionComposerProps` | type | props | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalExtensionEditorComposer`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalExtensionEditorComposer` | fn | The equivalent of LexicalComposer for an editor that was already built for extensions, typically used with nested editors. | VIEW | no | not-needed | P1 |
| [ ] | `LexicalExtensionEditorComposerProps` | type | props | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalHashtagPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `HashtagPlugin` | fn | registerLexicalHashtag | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalHistoryPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `HistoryPlugin` | fn | registerHistory | VIEW | no | not-needed | P1 |
| [ ] | `createEmptyHistoryState` | fn | re-export of `@lexical/history` | MODEL | via `@lexical/history` | lexical_model | P0 |
| [ ] | `HistoryState` | type | re-export of `@lexical/history` | MODEL | no | lexical_model | P1 |

Entry point `@lexical/react/LexicalHorizontalRuleNode`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$createHorizontalRuleNode` | fn | factory for HorizontalRuleNode (applies node replacement) | VIEW | no | not-needed | P2 |
| [ ] | `$isHorizontalRuleNode` | fn | re-export of `@lexical/extension` | MODEL | no | not-needed (S3 §1a.17) | P1 |
| [ ] | `INSERT_HORIZONTAL_RULE_COMMAND` | command | re-export of `@lexical/extension` | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `SerializedHorizontalRuleNode` | type | re-export of `@lexical/extension` | MODEL | no | not-needed (S3 §1a.17) | P2 |
| [ ] | `HorizontalRuleNode` | class | re-export of @lexical/extension HorizontalRuleNode (+ React decorator) | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalHorizontalRulePlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `HorizontalRulePlugin` | fn | INSERT_HORIZONTAL_RULE_COMMAND handler | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalLinkPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LinkPlugin` | fn | registerLink (validateUrl, attributes) | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalListPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ListPlugin` | fn | registerList | VIEW | no | not-needed | P1 |
| [ ] | `ListPluginProps` | type | props (hasStrictIndent, shouldPreserveNumbering) | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalMarkdownShortcutPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `MarkdownShortcutPlugin` | fn | registerMarkdownShortcuts | VIEW | no | not-needed | P1 |
| [ ] | `DEFAULT_TRANSFORMERS` | const | transformers used by MarkdownShortcutPlugin | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalNestedComposer`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalNestedComposer` | fn | composer for nested editors | VIEW | no | not-needed | P1 |
| [ ] | `LexicalNestedComposerProps` | type | props | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalNodeContextMenuPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `NodeContextMenuOption` | class | context menu option | VIEW | no | not-needed | P2 |
| [ ] | `NodeContextMenuPlugin` | const | context menu for nodes | VIEW | no | not-needed | P2 |
| [ ] | `NodeContextMenuSeparator` | class | separator | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalNodeEventPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `NodeEventPlugin` | fn | DOM event on node type | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalNodeMenuPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LexicalNodeMenuPlugin` | fn | menu anchored to a node | VIEW | no | not-needed | P1 |
| [ ] | `NodeMenuPluginProps` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `MenuOption` | class | menu option base class (key, ref, icon) | VIEW | no | not-needed | P1 |
| [ ] | `MenuRenderFn` | type | menu render callback | VIEW | no | not-needed | P1 |
| [ ] | `MenuResolution` | type | {match, getRect} | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalOnChangePlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `OnChangePlugin` | fn | onChange callback (ignoreSelectionChange, ignoreHistoryMerge) | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalPlainTextPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `PlainTextPlugin` | fn | mount plain text | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalRichTextPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `RichTextPlugin` | fn | mount rich text (registerRichText + placeholder + decorators) | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalSelectionAlwaysOnDisplay`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `SelectionAlwaysOnDisplay` | fn | plugin: keep selection painted on blur | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalTabIndentationPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TabIndentationPlugin` | fn | This plugin adds the ability to indent content using the tab key. | VIEW | no | not-needed | P2 |
| [ ] | `registerTabIndentation` | fn | re-export of `@lexical/extension` | MODEL | no | lexical_rich_nodes | P1 |

Entry point `@lexical/react/LexicalTableOfContentsPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TableOfContentsPlugin` | fn | collect headings for TOC | VIEW | no | not-needed | P2 |
| [ ] | `TableOfContentsEntry` | type | [key, text, tag] | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalTablePlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TablePlugin` | fn | A plugin to enable all of the features of Lexical's TableNode. | VIEW | no | not-needed | P1 |
| [ ] | `TablePluginProps` | type | props | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/LexicalTreeView`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TreeView` | fn | TreeView is a React component that provides a visual representation of the Lexical editor's state and enables debugging features like time travel and custom tree node rendering. | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/LexicalTypeaheadMenuPlugin`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `getScrollParent` | fn | nearest scrollable ancestor | VIEW | no | not-needed | P2 |
| [ ] | `useBasicTypeaheadTriggerMatch` | fn | trigger-char + query regex matcher | VIEW | no | not-needed | P1 |
| [ ] | `LexicalTypeaheadMenuPlugin` | fn | typeahead menu on trigger match | VIEW | no | not-needed | P1 |
| [ ] | `PUNCTUATION` | const | punctuation char class used by typeahead regex | VIEW | no | not-needed | P2 |
| [ ] | `useDynamicPositioning` | fn | reposition menu on scroll/resize | VIEW | no | not-needed | P2 |
| [ ] | `SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND` | command | command: scroll typeahead option into view | VIEW | no | not-needed | P2 |
| [ ] | `TypeaheadMenuPluginProps` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `MenuOption` | class | menu option base class (key, ref, icon) | VIEW | no | not-needed | P1 |
| [ ] | `MenuRenderFn` | type | menu render callback | VIEW | no | not-needed | P1 |
| [ ] | `MenuResolution` | type | {match, getRect} | VIEW | no | not-needed | P1 |
| [ ] | `MenuTextMatch` | type | {leadOffset, matchingString, replaceableString} | VIEW | no | not-needed | P2 |
| [ ] | `TriggerFn` | type | fn(text, editor) -> MenuTextMatch \| null | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/ReactExtension`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `DefaultEditorChildrenComponent` | fn | default editor children | VIEW | no | not-needed | P2 |
| [ ] | `EditorChildrenComponentProps` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `ReactConfig` | type | ReactExtension config | VIEW | no | not-needed | P2 |
| [ ] | `ReactOutputs` | type | ReactExtension outputs | VIEW | no | not-needed | P2 |
| [ ] | `ReactExtension` | extension | An extension to use or configure React for use with Lexical. | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/ReactPluginHostExtension`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `mountReactExtensionComponent` | fn | mount an extension component via host | VIEW | no | not-needed | P1 |
| [ ] | `mountReactPluginComponent` | fn | mount a plugin component | VIEW | no | not-needed | P1 |
| [ ] | `mountReactPluginElement` | fn | mount a plugin element | VIEW | no | not-needed | P2 |
| [ ] | `mountReactPluginHost` | fn | mount React host for vanilla editors | VIEW | no | not-needed | P1 |
| [ ] | `DecoratorComponentProps` | type | props | VIEW | no | not-needed | P2 |
| [ ] | `HostMountCommandArg` | type | type | VIEW | no | not-needed | P2 |
| [ ] | `MountPluginCommandArg` | type | type | VIEW | no | not-needed | P2 |
| [ ] | `REACT_PLUGIN_HOST_MOUNT_ROOT_COMMAND` | command | command: react plugin host mount root | VIEW | no | not-needed | P2 |
| [ ] | `REACT_PLUGIN_HOST_MOUNT_PLUGIN_COMMAND` | command | command: react plugin host mount plugin | VIEW | no | not-needed | P2 |
| [ ] | `ReactPluginHostExtension` | extension | This extension provides a React host for editors that are not built with LexicalExtensionComposer (e.g. | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/ReactProviderExtension`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `ReactProviderExtension` | extension | An extension used to declare that there is a LexicalExtensionComposer or ReactPluginHostExtension available so that we can issue runtime warnings when plugins that depend on React are hosted in an environment where it is | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/TreeViewExtension`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TreeViewExtensionComponent` | fn | TreeView as an extension component | VIEW | no | not-needed | P2 |
| [ ] | `TreeViewConfig` | type | TreeViewExtension config | VIEW | no | not-needed | P2 |
| [ ] | `TreeViewExtension` | extension | Provides a configured TreeView debugging tool (React dependent) as an output component with configurable class names. | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/useExtensionComponent`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useExtensionDependency` | fn | hook: dependency output | VIEW | no | not-needed | P1 |
| [ ] | `useOptionalExtensionDependency` | fn | hook: optional dependency output | VIEW | no | not-needed | P1 |
| [ ] | `usePeerExtensionDependency` | fn | hook: peer dependency output | VIEW | no | not-needed | P1 |
| [ ] | `useExtensionComponent` | fn | Use a Component from the given Extension that uses the ReactExtension convention of exposing a Component property in its output. | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/useExtensionSignalValue`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useSignalValue` | fn | A React hook that subscribes to a signal and returns its current value. | VIEW | no | not-needed | P1 |
| [ ] | `useExtensionSignalValue` | fn | A React hook that subscribes to a signal property from a Lexical extension's output and returns its current value. | VIEW | no | not-needed | P1 |
| [ ] | `SignalValue` | type | Type helper that extracts the value type from a ReadonlySignal. | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/useLexicalEditable`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useLexicalEditable` | fn | Get the current value for {@link LexicalEditor.isEditable} using {@link useLexicalSubscription}. | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/useLexicalIsTextContentEmpty`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useLexicalIsTextContentEmpty` | fn | hook: root text empty | VIEW | no | not-needed | P1 |

Entry point `@lexical/react/useLexicalNodeSelection`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useLexicalNodeSelection` | fn | A custom hook to manage the selection state of a specific node in a Lexical editor. | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/useLexicalSubscription`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useLexicalSubscription` | fn | Shortcut to Lexical subscriptions when values are used for render. | VIEW | no | not-needed | P2 |
| [ ] | `LexicalSubscription` | type | {initialValueFn, subscribe} | VIEW | no | not-needed | P2 |

Entry point `@lexical/react/useLexicalTextEntity`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `useLexicalTextEntity` | fn | hook: registerLexicalTextEntity | VIEW | no | not-needed | P2 |

### `@lexical/rich-text` (19 exports: 19 own, 0 re-exported; MODEL 12 / BRIDGE 6 / VIEW 1; P0 9 / P1 3 / P2 7; imported by Macro: 9)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$createQuoteNode` | fn | factory for QuoteNode (applies node replacement) | MODEL | yes (15 files) | lexical_rich_nodes | P0 |
| [ ] | `$isQuoteNode` | fn | type guard for QuoteNode | MODEL | yes (6 files) | lexical_rich_nodes | P0 |
| [ ] | `$createHeadingNode` | fn | factory for HeadingNode (applies node replacement) | MODEL | yes (7 files) | lexical_rich_nodes | P0 |
| [ ] | `$isHeadingNode` | fn | type guard for HeadingNode | MODEL | yes (7 files) | lexical_rich_nodes | P0 |
| [ ] | `eventFiles` | fn | inspect a DataTransfer-bearing event: [hasFiles, files, hasTextContent] | VIEW | no | web-view | P2 |
| [ ] | `registerRichText` | fn | register all rich-text default command handlers (see §3A.2) | BRIDGE | yes (15 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `SerializedHeadingNode` | type | JSON shape of HeadingNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `DRAG_DROP_PASTE` | command | command dispatched with File[] dropped/pasted | BRIDGE | yes (1 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `SerializedQuoteNode` | type | JSON shape of QuoteNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `QuoteNode` | class | blockquote element node | BRIDGE | yes (15 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `HeadingTagType` | type | 'h1'..'h6' | MODEL | yes (2 files) | shim-only (TS type) | P0 |
| [ ] | `HeadingNode` | class | heading element node with tag h1..h6 | BRIDGE | yes (10 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `EscapeFormatTrigger` | type | Trigger types that cause format escape at text node boundaries. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `TriggerConfig` | type | Trigger flags for a single format type. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `EscapeFormatTriggerConfig` | type | Per-format trigger configuration. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `RichTextConfig` | type | Configuration for {@link RichTextExtension}. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `RichTextExtension` | extension | extension: registers HeadingNode/QuoteNode + registerRichText | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `RichTextImportExtension` | extension | Bundles {@link RichTextImportRules} (plus {@link CoreImportExtension}) into a single dependency. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `RichTextImportRules` | const | Import rules for {@link HeadingNode } and {@link QuoteNode }, including the Google Docs title heuristic that the legacy `HeadingNode.importDOM` declared. | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/selection` (25 exports: 23 own, 2 re-exported; MODEL 21 / BRIDGE 2 / VIEW 2; P0 5 / P1 4 / P2 16; imported by Macro: 4)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `$addNodeStyle` | const | no-op kept for compatibility (styles are parsed on demand in v0.45) | MODEL | no | lexical_model | P2 |
| [ ] | `$ensureForwardRangeSelection` | fn | Ensure that the given RangeSelection is not backwards. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$forEachSelectedTextNode` | fn | iterate selected text nodes, splitting partial edge nodes first | MODEL | no | lexical_model | P2 |
| [ ] | `$isAtNodeEnd` | fn | Determines if the current selection is at the end of the node. | MODEL | no | lexical_model | P2 |
| [ ] | `$patchStyleText` | fn | Applies the provided styles to the TextNodes in the provided Selection. | MODEL | no | lexical_model | P1 |
| [ ] | `$sliceSelectedTextNodeContent` | fn | Generally used to append text content to HTML and JSON. | MODEL | no | lexical_model | P1 |
| [ ] | `$trimTextContentFromAnchor` | fn | Trims text from a node in order to shorten it, eg. | MODEL | no | lexical_model | P2 |
| [ ] | `$copyBlockFormatIndent` | fn | copy format+indent from one block to another (used by $setBlocksType) | MODEL | no | lexical_model | P2 |
| [ ] | `$getSelectionStyleValueForProperty` | fn | Returns the current value of a CSS property for TextNodes in the Selection, if set. | MODEL | no | lexical_model | P1 |
| [ ] | `$isParentElementRTL` | fn | Tests a parent element for right to left direction. | MODEL | no | lexical_model | P2 |
| [ ] | `$moveCaretSelection` | fn | Moves the selection according to the arguments. | MODEL | no | lexical_model | P2 |
| [ ] | `$moveCharacter` | fn | Moves selection by character according to arguments. | BRIDGE | no | lexical_model + shim | P2 |
| [ ] | `$setBlocksType` | fn | Converts all nodes in the selection that are of one block type to another. | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$shouldOverrideDefaultCharacterSelection` | fn | Determines if the default character selection should be overridden. | BRIDGE | no | lexical_model + shim | P2 |
| [ ] | `$wrapNodes` | fn | wrap selected nodes' blocks in a created element (deprecated) | MODEL | no | lexical_model | P2 |
| [ ] | `$getComputedStyleForElement` | fn | Gets the computed DOM styles of the element. | MODEL | no | lexical_model | P2 |
| [ ] | `$getComputedStyleForParent` | fn | Gets the computed DOM styles of the parent of the node. | MODEL | no | lexical_model | P2 |
| [ ] | `$isParentRTL` | fn | Determines whether a node's parent is RTL. | MODEL | no | lexical_model | P2 |
| [ ] | `createDOMRange` | fn | Creates a selection range for the DOM. | VIEW | yes (2 files) | web-view | P0 |
| [ ] | `createRectsFromDOMRange` | fn | Creates DOMRects, generally used to help the editor find a specific location on the screen. | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `getCSSFromStyleObject` | fn | Serializes a style object into a CSS declaration string, the inverse of {@link getStyleObjectFromCSS}. | MODEL | no | lexical_model | P2 |
| [ ] | `getStyleObjectFromCSS` | const | parse a CSS string into a {prop: value} object (cached) | MODEL | no | lexical_model | P1 |
| [ ] | `trimTextContentFromAnchor` | const | delete N characters backwards from the anchor across nodes (character limit) | MODEL | no | lexical_model | P2 |
| [ ] | `$cloneWithProperties` | fn | re-export of `lexical` | MODEL | no | lexical_model | P2 |
| [ ] | `$selectAll` | fn | re-export of `lexical` | MODEL | via `lexical` | lexical_model | P0 |

### `@lexical/table` (71 exports: 71 own, 0 re-exported; MODEL 56 / BRIDGE 8 / VIEW 7; P0 33 / P1 8 / P2 30; imported by Macro: 33)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `SerializedTableCellNode` | type | JSON shape of TableCellNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createTableCellNode` | fn | factory for TableCellNode (applies node replacement) | MODEL | yes (7 files) | lexical_rich_nodes | P0 |
| [ ] | `$isTableCellNode` | fn | type guard for TableCellNode | MODEL | yes (22 files) | lexical_rich_nodes | P0 |
| [ ] | `TableCellHeaderStates` | const | header bitmask: NO_STATUS 0, ROW 1, COLUMN 2, BOTH 3 | MODEL | yes (9 files) | lexical_rich_nodes | P0 |
| [ ] | `TableCellNode` | class | table cell: colSpan, rowSpan, headerState, width, backgroundColor, verticalAlign | BRIDGE | yes (13 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `InsertTableCommandPayload` | type | {rows, columns, includeHeaders} | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `InsertTableCommandPayloadHeaders` | type | boolean \| {rows, columns} header flags | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `INSERT_TABLE_COMMAND` | command | command: insert table | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `TableConfig` | type | TableExtension config: hasCellMerge, hasCellBackgroundColor, hasTabHandler, hasHorizontalScroll, hasNestedTables, hasFitNestedTables | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `TableExtension` | extension | Configures {@link TableNode}, {@link TableRowNode}, {@link TableCellNode} and registers table behaviors (see {@link TableConfig}) | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `SerializedTableNode` | type | JSON shape of TableNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createTableNode` | fn | factory for TableNode (applies node replacement) | MODEL | yes (9 files) | lexical_rich_nodes | P0 |
| [ ] | `$getElementForTableNode` | fn | TableDOMTable for a table node (view grid) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$isScrollableTablesActive` | fn | type guard for ScrollableTablesActive | VIEW | no | web-view | P1 |
| [ ] | `$isTableNode` | fn | type guard for TableNode | MODEL | yes (13 files) | lexical_rich_nodes | P0 |
| [ ] | `setScrollableTablesActive` | fn | enable horizontal-scroll wrapper DOM for tables (view) | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `TableNode` | class | table element: colWidths, rowStriping, frozenColumn/RowCount, scrollable wrapper | BRIDGE | yes (16 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `TableDOMCell` | type | observer grid cell {elem, x, y, highlighted, hasBackgroundColor} | VIEW | yes (1 files) | not-needed | P0 |
| [ ] | `$getTableAndElementByKey` | fn | {tableNode, tableElement} by key (view) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `TableObserver` | class | per-table DOM observer: tracks grid, drag/shift selection, highlights | BRIDGE | no | lexical_rich_nodes + web-view | P1 |
| [ ] | `registerTableCellUnmergeTransform` | fn | Register a transform to ensure that all TableCellNode have a colSpan and rowSpan of 1. | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `registerTablePlugin` | fn | Register table command listeners and the table integrity transforms. | MODEL | yes (1 files) | lexical_rich_nodes | P0 |
| [ ] | `registerTableSelectionObserver` | fn | attach TableObservers + selection handlers to every table (view+model) | BRIDGE | yes (1 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `SerializedTableRowNode` | type | JSON shape of TableRowNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createTableRowNode` | fn | factory for TableRowNode (applies node replacement) | MODEL | yes (10 files) | lexical_rich_nodes | P0 |
| [ ] | `$isTableRowNode` | fn | type guard for TableRowNode | MODEL | yes (13 files) | lexical_rich_nodes | P0 |
| [ ] | `TableRowNode` | class | table row element: height | BRIDGE | yes (6 files) | lexical_rich_nodes + web-view | P0 |
| [ ] | `TableMapType` | type | 2D grid of TableMapValueType (merged cells repeated) | MODEL | no | shim-only (TS type) | P1 |
| [ ] | `TableMapValueType` | type | {cell, startRow, startColumn} | MODEL | no | shim-only (TS type) | P2 |
| [ ] | `TableSelection` | class | rectangular cell selection: tableKey, anchor/focus cell points | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `TableSelectionShape` | type | {fromX, fromY, toX, toY} | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$createTableSelection` | fn | factory for TableSelection (applies node replacement) | MODEL | yes (4 files) | lexical_rich_nodes | P0 |
| [ ] | `$createTableSelectionFrom` | fn | factory for TableSelectionFrom (applies node replacement) | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$isTableSelection` | fn | type guard for TableSelection | MODEL | yes (9 files) | lexical_rich_nodes | P0 |
| [ ] | `HTMLTableElementWithWithTableSelectionState` | type | <table> carrying its TableObserver | VIEW | no | not-needed | P2 |
| [ ] | `$findCellNode` | fn | nearest ancestor TableCellNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$findTableNode` | fn | nearest ancestor TableNode | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `applyTableHandlers` | fn | install mouse/keyboard/command handlers for one table (view+model) | BRIDGE | no | lexical_rich_nodes + web-view | P2 |
| [ ] | `getDOMCellFromTarget` | fn | DOM cell under an event target (view) | VIEW | yes (6 files) | not-needed | P0 |
| [ ] | `getTableElement` | fn | the <table> element for a table node DOM (view) | VIEW | yes (1 files) | not-needed | P0 |
| [ ] | `getTableObserverFromTableElement` | fn | TableObserver stored on a <table> | VIEW | yes (1 files) | not-needed | P0 |
| [ ] | `$computeTableMap` | fn | build grid map + locate two cells (merged-cell aware) | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$computeTableMapSkipCellCheck` | fn | build grid map; cell args may be null | MODEL | yes (4 files) | lexical_rich_nodes | P0 |
| [ ] | `$createTableNodeWithDimensions` | fn | factory for TableNodeWithDimensions (applies node replacement) | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$deleteTableColumn` | fn | delete column at index (legacy, no merged cells) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$deleteTableColumn__EXPERIMENTAL` | const | alias of $deleteTableColumnAtSelection | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$deleteTableColumnAtSelection` | fn | delete selected columns (merged-cell aware) | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$deleteTableRow__EXPERIMENTAL` | const | alias of $deleteTableRowAtSelection | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$deleteTableRowAtSelection` | fn | delete selected rows (merged-cell aware) | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$getNodeTriplet` | fn | [cell, row, table] from a cell or point | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getTableCellNodeFromLexicalNode` | fn | nearest TableCellNode or null | MODEL | yes (5 files) | lexical_rich_nodes | P0 |
| [ ] | `$getTableCellNodeRect` | fn | {rowIndex, columnIndex, rowSpan, colSpan} of a cell | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getTableColumnIndexFromTableCellNode` | fn | column index of a cell (DOM-order, not map) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getTableNodeFromLexicalNodeOrThrow` | fn | nearest TableNode or throw | MODEL | yes (6 files) | lexical_rich_nodes | P0 |
| [ ] | `$getTableRowIndexFromTableCellNode` | fn | row index of a cell | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$getTableRowNodeFromTableCellNodeOrThrow` | fn | parent TableRowNode or throw | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$insertTableColumn` | fn | insert columns at index (legacy) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$insertTableColumn__EXPERIMENTAL` | const | alias of $insertTableColumnAtSelection | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$insertTableColumnAtSelection` | fn | Inserts a column before or after the current focus cell node, taking into account any spans. | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$insertTableRow` | fn | insert rows at index (legacy) | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$insertTableRow__EXPERIMENTAL` | const | alias of $insertTableRowAtSelection | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$insertTableRowAtSelection` | fn | Inserts a table row before or after the current focus cell node, taking into account any spans. | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `$isSimpleTable` | fn | Checks if the table does not have any merged cells. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$mergeCells` | fn | merge a set of cells into the top-left cell (content concatenated) | MODEL | yes (2 files) | lexical_rich_nodes | P0 |
| [ ] | `$moveTableColumn` | fn | Moves a column from one position to another within a simple (non-merged) table. | MODEL | no | lexical_rich_nodes | P1 |
| [ ] | `$removeTableRowAtIndex` | fn | remove row by index | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `$unmergeCell` | fn | split the selected merged cell back into 1x1 cells | MODEL | yes (3 files) | lexical_rich_nodes | P0 |
| [ ] | `TableImportExtension` | extension | Bundles {@link TableImportRules} (plus {@link CoreImportExtension}) into a single dependency. | BRIDGE | no | lexical_rich_nodes + shim | P1 |
| [ ] | `TableImportRules` | const | Import rules for {@link TableNode }, {@link TableRowNode }, and {@link TableCellNode }. | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `TableRowSchema` | const | A {@link ChildSchema} that enforces TableRowNode invariants: only `TableCellNode` children are accepted; non-cell children are dropped (the legacy converter does the same via `$descendantsMatching`). | MODEL | no | lexical_rich_nodes | P2 |
| [ ] | `TableSchema` | const | A {@link ChildSchema} that enforces TableNode invariants: only `TableRowNode` children are accepted; orphan `TableCellNode` runs are wrapped in a synthesized row. | MODEL | no | lexical_rich_nodes | P2 |

### `@lexical/tailwind` (1 exports: 1 own, 0 re-exported; MODEL 0 / BRIDGE 0 / VIEW 1; P0 0 / P1 1 / P2 0; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TailwindExtension` | extension | Configures the lexical theme ({@link EditorThemeClasses}) with tailwind defaults | VIEW | no | not-needed | P1 |

### `@lexical/text` (9 exports: 9 own, 0 re-exported; MODEL 9 / BRIDGE 0 / VIEW 0; P0 0 / P1 3 / P2 6; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `TextNodeWithOffset` | type | {node, offset} result of $findTextIntersectionFromCharacters | MODEL | no | lexical_model | P2 |
| [ ] | `$canShowPlaceholder` | fn | Determines if the input should show the placeholder. | MODEL | no | lexical_model | P2 |
| [ ] | `$canShowPlaceholderCurry` | fn | Returns a function that executes {@link $canShowPlaceholder} | MODEL | no | lexical_model | P2 |
| [ ] | `$findTextIntersectionFromCharacters` | fn | Finds a TextNode with a size larger than targetCharacters and returns the node along with the remaining length of the text. | MODEL | no | lexical_model | P2 |
| [ ] | `$isRootTextContentEmpty` | fn | Determines if the root has any text content and can trim any whitespace if it does. | MODEL | no | lexical_model | P1 |
| [ ] | `$isRootTextContentEmptyCurry` | fn | Returns a function that executes {@link $isRootTextContentEmpty} | MODEL | no | lexical_model | P1 |
| [ ] | `EntityMatch` | type | {start, end} returned by a text-entity matcher | MODEL | no | lexical_model | P2 |
| [ ] | `registerLexicalTextEntity` | fn | Returns a tuple that can be rested (...) into mergeRegister to clean up node transforms listeners that transforms text into another node, eg. | MODEL | no | lexical_model | P2 |
| [ ] | `$rootTextContent` | fn | Returns the root's text content. | MODEL | no | lexical_model | P1 |

### `@lexical/utils` (58 exports: 38 own, 20 re-exported; MODEL 34 / BRIDGE 0 / VIEW 24; P0 12 / P1 21 / P2 25; imported by Macro: 8)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `isMimeType` | fn | Returns true if the file type matches the types passed within the acceptableMimeTypes array, false otherwise. | VIEW | no | not-needed | P2 |
| [ ] | `mediaFileReader` | fn | Lexical File Reader with: 1. | VIEW | no | not-needed | P2 |
| [ ] | `$dfs` | fn | "Depth-First Search" starts at the root/top node of a tree and goes as far as it can down a branch end before backtracking and finding a new path. | MODEL | yes (8 files) | lexical_model | P0 |
| [ ] | `$getAdjacentCaret` | fn | Get the adjacent caret in the same direction | MODEL | no | lexical_model | P2 |
| [ ] | `$reverseDfs` | fn | $dfs iterator (right to left). | MODEL | no | lexical_model | P1 |
| [ ] | `$dfsIterator` | fn | $dfs iterator (left to right). | MODEL | yes (12 files) | lexical_model | P0 |
| [ ] | `$getNextSiblingOrParentSibling` | fn | Returns the Node sibling when this exists, otherwise the closest parent sibling. | MODEL | no | lexical_model | P1 |
| [ ] | `$getDepth` | fn | depth of a node from root | MODEL | no | lexical_model | P2 |
| [ ] | `$getNextRightPreorderNode` | fn | Performs a right-to-left preorder tree traversal. | MODEL | no | lexical_model | P2 |
| [ ] | `$reverseDfsIterator` | fn | $dfs iterator (right to left). | MODEL | no | lexical_model | P2 |
| [ ] | `$getNearestNodeOfType` | fn | Takes a node and traverses up its ancestors (toward the root node) in order to find a specific type of node. | MODEL | no | lexical_model | P2 |
| [ ] | `$getNearestBlockElementAncestorOrThrow` | fn | Returns the element node of the nearest ancestor, otherwise throws an error. | MODEL | no | lexical_model | P2 |
| [ ] | `registerNestedElementResolver` | fn | Attempts to resolve nested element nodes of the same type into a single node of that type. | MODEL | no | lexical_model | P2 |
| [ ] | `$restoreEditorState` | fn | Clones the editor and marks it as dirty to be reconciled. | MODEL | no | lexical_model | P1 |
| [ ] | `$insertNodeToNearestRoot` | fn | If the selected insertion area is the root/shadow root node (see {@link lexical !$isRootOrShadowRoot}), the node will be appended there, otherwise, it will be inserted before the insertion area. | MODEL | no | lexical_model | P1 |
| [ ] | `$insertNodeToNearestRootAtCaret` | fn | If the insertion caret is the root/shadow root node (see {@link lexical !$isRootOrShadowRoot}), the node will be inserted there, otherwise the parent nodes will be split according to the given options. | MODEL | yes (1 files) | lexical_model | P0 |
| [ ] | `$insertNodeIntoLeaf` | fn | Inserts a node into leaf — the deepest accessible node at the carriage position | MODEL | no | lexical_model | P2 |
| [ ] | `$wrapNodeInElement` | fn | Wraps the node into another node created from a createElementNode function, eg. | MODEL | yes (6 files) | lexical_model | P0 |
| [ ] | `objectKlassEquals` | fn | compare object constructor names (cross-realm instanceof) | MODEL | no | lexical_model | P1 |
| [ ] | `$filter` | fn | map nodes through fn and drop nulls | MODEL | no | lexical_model | P2 |
| [ ] | `$handleIndentAndOutdent` | fn | Applies the provided callback to each indentable block element in the Selection | MODEL | no | lexical_model | P2 |
| [ ] | `$insertFirst` | fn | Appends the node before the first child of the parent node | MODEL | no | lexical_model | P2 |
| [ ] | `calculateZoomLevel` | fn | Calculates the zoom level of an element as a result of using css zoom property. | VIEW | yes (1 files) | web-view | P0 |
| [ ] | `$isEditorIsNestedEditor` | fn | Checks if the editor is a nested editor created by LexicalNestedComposer | MODEL | no | lexical_model | P2 |
| [ ] | `$unwrapAndFilterDescendants` | fn | A depth first last-to-first traversal of root that stops at each node that matches $predicate and ensures that its parent is root. | MODEL | no | lexical_model | P1 |
| [ ] | `$descendantsMatching` | fn | A depth first traversal of the children array that stops at and collects each node that `$predicate` matches. | MODEL | no | lexical_model | P1 |
| [ ] | `$firstToLastIterator` | fn | Return an iterator that yields each child of node from first to last, taking care to preserve the next sibling before yielding the value in case the caller removes the yielded node. | MODEL | no | lexical_model | P1 |
| [ ] | `$lastToFirstIterator` | fn | Return an iterator that yields each child of node from last to first, taking care to preserve the previous sibling before yielding the value in case the caller removes the yielded node. | MODEL | no | lexical_model | P1 |
| [ ] | `$unwrapNode` | fn | Replace this node with its children | MODEL | yes (4 files) | lexical_model | P0 |
| [ ] | `makeStateWrapper` | fn | EXPERIMENTAL A convenience interface for working with {@link $getState} and {@link $setState}. | MODEL | no | lexical_model | P2 |
| [ ] | `markSelection` | fn | Place one or multiple newly created Nodes at the current selection. | VIEW | no | not-needed | P1 |
| [ ] | `positionNodeOnRange` | fn | Place one or multiple newly created Nodes at the passed Range's position. | VIEW | no | not-needed | P2 |
| [ ] | `selectionAlwaysOnDisplay` | fn | keep a painted selection highlight when editor blurs (view) | VIEW | no | not-needed | P2 |
| [ ] | `$findMatchingParent` | fn | re-export of `lexical` | MODEL | yes (19 files) | lexical_model | P0 |
| [ ] | `$getAdjacentSiblingOrParentSiblingCaret` | fn | re-export of `lexical` | MODEL | no | lexical_model | P2 |
| [ ] | `$splitNode` | fn | re-export of `lexical` | MODEL | via `lexical` | lexical_model | P0 |
| [ ] | `addClassNamesToElement` | fn | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `isBlockDomNode` | fn | re-export of `lexical` | VIEW | no | web-view | P2 |
| [ ] | `isHTMLAnchorElement` | fn | re-export of `lexical` | VIEW | no | web-view | P2 |
| [ ] | `isHTMLElement` | fn | re-export of `lexical` | VIEW | via `lexical` | web-view | P0 |
| [ ] | `isInlineDomNode` | fn | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `mergeRegister` | fn | re-export of `lexical` | MODEL | yes (60 files) | lexical_model | P0 |
| [ ] | `removeClassNamesFromElement` | fn | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `CAN_USE_BEFORE_INPUT` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `CAN_USE_DOM` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `IS_ANDROID` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `IS_ANDROID_CHROME` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `IS_APPLE` | const | re-export of `lexical` | VIEW | via `lexical` | web-view | P0 |
| [ ] | `IS_APPLE_WEBKIT` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `IS_CHROME` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `IS_FIREFOX` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `IS_IOS` | const | re-export of `lexical` | VIEW | via `lexical` | web-view | P0 |
| [ ] | `IS_SAFARI` | const | re-export of `lexical` | VIEW | no | web-view | P1 |
| [ ] | `DFSNode` | type | {depth, node} entry yielded by $dfs | MODEL | no | lexical_model | P2 |
| [ ] | `DOMNodeToLexicalConversion` | type | fn(DOM node) -> LexicalNode for registerNestedElementResolver/html utils | VIEW | no | not-needed | P2 |
| [ ] | `DOMNodeToLexicalConversionMap` | type | tag -> DOMNodeToLexicalConversion | VIEW | no | not-needed | P2 |
| [ ] | `ObjectKlass` | type | class type for objectKlassEquals | MODEL | no | lexical_model | P2 |
| [ ] | `StateConfigWrapper` | type | A wrapper that creates bound functions and methods for the StateConfig to save some boilerplate when defining methods or exporting only the accessors from your modules rather than exposing the StateConfig directly. | MODEL | no | lexical_model | P2 |

### `@lexical/yjs` (31 exports: 31 own, 0 re-exported; MODEL 29 / BRIDGE 0 / VIEW 2; P0 0 / P1 7 / P2 24; imported by Macro: 0)

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `createUndoManager` | fn | Y.UndoManager scoped to the binding root | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `initLocalState` | fn | set awareness local user state (name, color, focus) | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `setLocalStateFocus` | fn | update awareness focus flag | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `UserState` | type | awareness user state shape | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `CONNECTED_COMMAND` | command | command: connected | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `TOGGLE_CONNECT_COMMAND` | command | command: toggle connect | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `DIFF_VERSIONS_COMMAND__EXPERIMENTAL` | command | render a diff between two Y snapshots | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL` | command | clear a rendered version diff | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `$getYChangeState` | fn | insert/delete change state of a node in snapshot rendering | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `renderSnapshot__EXPERIMENTAL` | fn | Replaces the editor content with a view that compares the state between two given snapshots. | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `ProviderAwareness` | type | awareness interface the provider must expose | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `Operation` | type | Yjs delta op | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `Delta` | type | array of Yjs delta ops | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `YjsNode` | type | Yjs node union | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `YjsEvent` | type | Yjs event union | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `Provider` | type | Yjs provider interface (connect, disconnect, awareness, on/off) | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `BaseBinding` | type | binding fields shared by v1/v2 | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `Binding` | type | v1 binding: collab node tree mirroring the lexical tree | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `BindingV2` | type | v2 binding: XmlElement/XmlText based | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `ClientID` | type | Yjs client id | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `ExcludedProperties` | type | per-class node properties not synced | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `createBinding` | fn | create a v1 binding for an editor + Y.Doc | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `createBindingV2__EXPERIMENTAL` | fn | create a v2 binding | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `getAnchorAndFocusCollabNodesForUserState` | fn | resolve a remote user's cursor to collab nodes | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `syncCursorPositions` | fn | render remote cursors/selections (view) | VIEW | no | not-needed | P2 |
| [ ] | `SyncCursorPositionsFn` | type | signature of syncCursorPositions | VIEW | no | not-needed | P2 |
| [ ] | `syncLexicalUpdateToYjs` | fn | apply a lexical update (dirty sets) to the Y.Doc (v1) | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `syncLexicalUpdateToYjsV2__EXPERIMENTAL` | fn | apply a lexical update to the Y.Doc (v2) | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `syncYjsChangesToLexical` | fn | apply Y events to the lexical state (v1) | MODEL | no | lexical_loro (reference only) | P1 |
| [ ] | `syncYjsChangesToLexicalV2__EXPERIMENTAL` | fn | apply Y events to the lexical state (v2) | MODEL | no | lexical_loro (reference only) | P2 |
| [ ] | `syncYjsStateToLexicalV2__EXPERIMENTAL` | fn | full Y state -> lexical (v2) | MODEL | no | lexical_loro (reference only) | P2 |

### `@lexical/internal` (8 exports: 8 own, 0 re-exported; MODEL 8 / BRIDGE 0 / VIEW 0; P0 0 / P1 7 / P2 1; imported by Macro: 0)


Entry point `@lexical/internal/devInvariant`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | If `!cond`, throw in `__DEV__` like an invariant and warn in prod. | MODEL | no | shim-only | P1 |

Entry point `@lexical/internal/formatDevErrorMessage`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | Copyright (c) Meta Platforms, Inc. | MODEL | no | shim-only | P1 |

Entry point `@lexical/internal/formatDevWarningMessage`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | Copyright (c) Meta Platforms, Inc. | MODEL | no | shim-only | P1 |

Entry point `@lexical/internal/formatProdErrorMessage`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | Copyright (c) Meta Platforms, Inc. | MODEL | no | shim-only | P1 |

Entry point `@lexical/internal/formatProdWarningMessage`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | Copyright (c) Meta Platforms, Inc. | MODEL | no | shim-only | P1 |

Entry point `@lexical/internal/invariant`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | Copyright (c) Meta Platforms, Inc. | MODEL | no | shim-only | P1 |

Entry point `@lexical/internal/version`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `LEXICAL_VERSION` | const | version string | MODEL | no | shim-only | P2 |

Entry point `@lexical/internal/warnOnlyOnce`:

| ✓ | Symbol | Kind | What it does | Class | Macro | Target crate | Pri |
|---|---|---|---|---|---|---|---|
| [ ] | `default` | fn | warn once helper | MODEL | no | shim-only | P1 |

## 3. Behaviours that are not symbols

Each item is `- [ ] **ID** behaviour — detail (file:line)`, with paths abbreviated per part header. The trailing `(file:line)` cite is the item's `Src` range (S4 §1.3 reads it; R2.1 adds no separate column). IDs are unique across §3: §3A's selection-model items are `SEL-nn`, §3D's `@lexical/selection` items are `LSEL-nn` (R2.1, audit R2-2 G-2). Parts: **3A** commands, DOM event→command mapping, registerRichText/registerPlainText/dragon, normalization, nodes, transforms, update tags, listeners, JSON, NodeState, `$config`, carets, selection. **3B** markdown (transformers, import/export engines, shortcuts), link/autolink, hashtag, text, overflow, offset, mark, tailwind, file, React plugins with model rules. **3C** tables, lists, code (incl. Macro patches). **3D** history merge rules, clipboard formats, HTML import/export, extension system, headless, yjs (reference), selection and utils helpers.

### 3A — Lexical v0.45.0 behaviour inventory — part A (commands, events, rich/plain text, model core, NodeState, $config, carets, selection)

Paths relative to `target/lexical-upstream/packages/`. `L/` = `lexical/src/`.
Classification: **MODEL** = pure editor-state op (portable headless); **VIEW** = DOM/browser only; **BRIDGE** = translates DOM/browser input into model ops.

---

#### 1. Commands (`L/LexicalCommands.ts`) and their DOM sources (`L/LexicalEvents.ts`)

##### 1.0 Command mechanics
- [ ] **CMD-01** `createCommand(type?)` returns `{type}`; identity is by object reference, `type` is debug-only (L/LexicalCommands.ts:27)
- [ ] **CMD-02** Priorities: EDITOR=0, LOW=1, NORMAL=2, HIGH=3, CRITICAL=4; BEFORE_* = -8..-4 normalize via `priority & 7` and are inserted at the *front* of that bucket (addFront), normal priorities at the back (L/LexicalEditor.ts:491-536, 1170-1225)
- [ ] **CMD-03** Dispatch iterates priority 4→0; within a bucket in insertion order; first listener returning `true` stops propagation (L/LexicalUpdates.ts:803-856)
- [ ] **CMD-04** Dispatch walks editor + parent editors (`getEditorsToPropagate`) per priority level; each listener batch runs inside `updateEditorSync` (sync if already in this editor's update and no options) (L/LexicalUpdates.ts:803-842, 1122-1132)
- [ ] **CMD-05** If a parent editor is currently `_updating`, propagation to it stops and the command is re-dispatched to that parent asynchronously via `parent.update(...)`; return value is then `false` (L/LexicalUpdates.ts:820-853)
- [ ] **CMD-06** Listener signature `(payload, editor) => boolean`; second arg is the originating editor (`fromEditor`) (L/LexicalEditor.ts:471)
- [ ] **CMD-07** Unregister removes listener; when all 5 buckets empty the command entry is deleted (L/LexicalEditor.ts:1217-1225)
- [ ] **CMD-08** `registerCommand` without priority throws (L/LexicalEditor.ts:1176)
- [ ] **CMD-09** Default core handlers registered at createEditor at EDITOR priority: BEFORE_INPUT, INPUT, COMPOSITION_START, COMPOSITION_END, KEY_DOWN (L/LexicalEvents.ts:679-701; L/LexicalEditor.ts:908)

##### 1.1 Command table
- [ ] **CMD-10** `SELECTION_CHANGE_COMMAND` void — `selectionchange` (document-level, after selection/format recompute); also at commit when pending selection is non-Range and differs from current (L/LexicalEvents.ts:463; L/LexicalUpdates.ts:681-687) — BRIDGE
- [ ] **CMD-11** `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` `{nodes, selection}` — clipboard `$insertGeneratedNodes`; if unhandled, falls back to `selection.insertNodes(nodes)` + selection fixup (lexical-clipboard/src/clipboard.ts:395-410) — MODEL
- [ ] **CMD-12** `CLICK_COMMAND` MouseEvent (PointerEvent in practice) — `click` (runs even when not editable) (L/LexicalEvents.ts:502-547) — BRIDGE
- [ ] **CMD-13** `BEFORE_INPUT_COMMAND` InputEvent — `beforeinput` except `deleteCompositionText`, `insertCompositionText`, and Firefox paste inputTypes (L/LexicalEvents.ts:703-722) — BRIDGE
- [ ] **CMD-14** `INPUT_COMMAND` InputEvent — `input` (stopPropagation; runs in update with `{event}`) (L/LexicalEvents.ts:1064-1080) — BRIDGE
- [ ] **CMD-15** `COMPOSITION_START_COMMAND` CompositionEvent — `compositionstart` (L/LexicalEvents.ts:1182-1187) — BRIDGE
- [ ] **CMD-16** `COMPOSITION_END_COMMAND` CompositionEvent — `compositionend` (non-Firefox, non-desktop-Safari; Firefox defers to `input`, Safari defers to next keydown) (L/LexicalEvents.ts:1291-1313) — BRIDGE
- [ ] **CMD-17** `DELETE_CHARACTER_COMMAND` boolean (true=backward) — keydown non-Backspace delete-backward (Ctrl+H mac) / non-Delete delete-forward (Ctrl+D mac); beforeinput `deleteContentBackward` (true), `deleteContent` (false); dispatched by rich/plain KEY_BACKSPACE/KEY_DELETE handlers (L/LexicalEvents.ts:1369-1386, 836, 1000) — MODEL
- [ ] **CMD-18** `INSERT_LINE_BREAK_COMMAND` boolean (true=selectStart, caret stays before break) — keydown Ctrl+O mac (true); beforeinput insertText "\n" (false), `insertLineBreak` (false), `insertParagraph` after Shift+Enter keydown on non-iOS (false); rich KEY_ENTER+shift; plain KEY_ENTER (L/LexicalEvents.ts:1362-1365, 891, 949, 963) — MODEL
- [ ] **CMD-19** `INSERT_PARAGRAPH_COMMAND` void — beforeinput insertText "\n\n", `insertParagraph`; rich KEY_ENTER (L/LexicalEvents.ts:894, 965) — MODEL
- [ ] **CMD-20** `CONTROLLED_TEXT_INSERTION_COMMAND` InputEvent|string — beforeinput insertText/insertTranspose (string, when `$shouldPreventDefaultAndInsertText`), insertFromYank/insertFromDrop/insertReplacementText/insertFromComposition (event); input event fallback (string); compositionstart zero-width/nbsp char (L/LexicalEvents.ts:911, 929, 942, 1141, 1215) — MODEL (string) / BRIDGE (event w/ dataTransfer)
- [ ] **CMD-21** `PASTE_COMMAND` ClipboardEvent|InputEvent|KeyboardEvent — `paste` (editable only); beforeinput insertFromPaste/insertFromPasteAsQuotation (L/LexicalEvents.ts:973, 1582-1590) — BRIDGE
- [ ] **CMD-22** `REMOVE_TEXT_COMMAND` InputEvent|null — beforeinput `deleteByComposition` (only if `$canRemoveText`), `deleteByDrag` (adds SKIP_SELECTION_FOCUS_TAG), `deleteByCut` (L/LexicalEvents.ts:977-997) — MODEL
- [ ] **CMD-23** `DELETE_WORD_COMMAND` boolean — keydown Ctrl+Backspace / Alt(Opt)+Backspace mac (true), Ctrl/Alt+Delete (false); beforeinput deleteWordBackward/Forward (L/LexicalEvents.ts:1387-1392, 1004-1011) — MODEL (needs DOM `modify`, see SEL-50)
- [ ] **CMD-24** `DELETE_LINE_COMMAND` boolean — keydown Cmd+Backspace mac (true), Cmd+Delete or Ctrl+K mac (false); beforeinput deleteHard/SoftLineBackward (true), deleteContentForward/deleteHard/SoftLineForward (false) (L/LexicalEvents.ts:1393-1398, 1014-1024) — MODEL (needs DOM `modify`)
- [ ] **CMD-25** **AMBIGUOUS** beforeinput `deleteContentForward` maps to DELETE_LINE_COMMAND(false), not DELETE_CHARACTER(false) (L/LexicalEvents.ts:1020-1024) — reproduce verbatim or treat as upstream bug
- [ ] **CMD-26** `FORMAT_TEXT_COMMAND` TextFormatType — keydown Ctrl/Cmd+B/U/I; beforeinput formatBold/Italic/Underline/StrikeThrough (L/LexicalEvents.ts:1399-1407, 1027-1045) — MODEL
- [ ] **CMD-27** `UNDO_COMMAND` / `REDO_COMMAND` void — keydown Cmd/Ctrl+Z; redo = Cmd+Shift+Z (mac) or Ctrl+Y / Ctrl+Shift+Z; beforeinput historyUndo/historyRedo (L/LexicalEvents.ts:1410-1415, 1047-1055; L/LexicalUtils.ts:1138-1150) — MODEL (handled by history pkg)
- [ ] **CMD-28** `KEY_DOWN_COMMAND` KeyboardEvent (type string "KEYDOWN_COMMAND") — every keydown while not composing (L/LexicalEvents.ts:1315-1325) — BRIDGE
- [ ] **CMD-29** `KEY_ARROW_RIGHT_COMMAND` / `KEY_ARROW_LEFT_COMMAND` — ArrowRight/Left with only shift allowed (L/LexicalUtils.ts:1160-1177) — BRIDGE
- [ ] **CMD-30** `MOVE_TO_END` / `MOVE_TO_START` — Cmd(mac)/Ctrl+ArrowRight/Left, shift any (L/LexicalUtils.ts:1166-1184) — BRIDGE
- [ ] **CMD-31** Alt+ArrowLeft/Right (mac word move) matches no arrow command (alt must be false) — falls to native (L/LexicalUtils.ts:1160-1184)
- [ ] **CMD-32** `KEY_ARROW_UP_COMMAND` / `KEY_ARROW_DOWN_COMMAND` — ArrowUp/Down, alt+shift any, no ctrl/meta (L/LexicalUtils.ts:1186-1198) — BRIDGE
- [ ] **CMD-33** `KEY_ENTER_COMMAND` KeyboardEvent|null — Shift+Enter (isLineBreak, sets isInsertLineBreak=true) or plain Enter (alt/ctrl/meta any, shift false; isInsertLineBreak=false); null payload from composition-end ending in "\n" (L/LexicalEvents.ts:1357-1368, 1282) — BRIDGE
- [ ] **CMD-34** `KEY_SPACE_COMMAND` — `event.key === ' '` any modifiers (L/LexicalUtils.ts:1204) — BRIDGE
- [ ] **CMD-35** `KEY_BACKSPACE_COMMAND` — Backspace (shift any); if handled → marks "handled selection command" to suppress next bogus macOS insertText (L/LexicalEvents.ts:1369-1377) — BRIDGE
- [ ] **CMD-36** `KEY_ESCAPE_COMMAND` — key Escape (L/LexicalEvents.ts:1378) — BRIDGE
- [ ] **CMD-37** `KEY_DELETE_COMMAND` — key Delete with no modifiers (L/LexicalEvents.ts:1380-1386) — BRIDGE
- [ ] **CMD-38** `KEY_TAB_COMMAND` — Tab, shift any (L/LexicalUtils.ts:1062) — BRIDGE
- [ ] **CMD-39** `INSERT_TAB_COMMAND` void — not DOM-dispatched; from TabIndentation KEY_TAB handler (lexical-extension/src/TabIndentationExtension.ts:84-99) — MODEL
- [ ] **CMD-40** `INDENT_CONTENT_COMMAND` / `OUTDENT_CONTENT_COMMAND` void — not DOM-dispatched; from TabIndentation, rich KEY_BACKSPACE at start of indented block — MODEL
- [ ] **CMD-41** `DROP_COMMAND` DragEvent — `drop` (editable only) (L/LexicalEvents.ts:1623-1627) — BRIDGE
- [ ] **CMD-42** `FORMAT_ELEMENT_COMMAND` ElementFormatType — not DOM-dispatched (toolbar) — MODEL
- [ ] **CMD-43** `DRAGSTART_COMMAND` / `DRAGOVER_COMMAND` / `DRAGEND_COMMAND` DragEvent — corresponding DOM events, editable only (L/LexicalEvents.ts:1592-1608) — VIEW/BRIDGE
- [ ] **CMD-44** `COPY_COMMAND` ClipboardEvent|KeyboardEvent|null — `copy` (dispatched even when not editable); keydown Cmd/Ctrl+C only when previous selection is non-null non-Range (NodeSelection/table) (L/LexicalEvents.ts:1575-1580, 1418-1432) — BRIDGE
- [ ] **CMD-45** `CUT_COMMAND` — `cut` (editable only); keydown Cmd/Ctrl+X only for non-Range previous selection (L/LexicalEvents.ts:1569-1574, 1428-1430) — BRIDGE
- [ ] **CMD-46** `SELECT_ALL_COMMAND` KeyboardEvent — keydown Cmd/Ctrl+A (always preventDefault); if handled marks handled-selection-command (L/LexicalEvents.ts:1418-1423) — MODEL
- [ ] **CMD-47** `CLEAR_EDITOR_COMMAND`, `CLEAR_HISTORY_COMMAND` void; `CAN_UNDO_COMMAND`, `CAN_REDO_COMMAND` boolean — never DOM-dispatched (history/app) (L/LexicalCommands.ts:219-228) — MODEL
- [ ] **CMD-48** `FOCUS_COMMAND` / `BLUR_COMMAND` FocusEvent — `focus`/`blur` on root, editable only (L/LexicalEvents.ts:1610-1621) — VIEW
- [ ] **CMD-49** `KEY_MODIFIER_COMMAND` (deprecated) — after any keydown where ctrl/shift/alt/meta held (L/LexicalEvents.ts:1435-1437) — BRIDGE
- [ ] **CMD-50** `DRAG_DROP_PASTE` (rich-text, type "DRAG_DROP_PASTE_FILE") Array<File> — rich DROP/PASTE with files (lexical-rich-text/src/index.ts:127) — BRIDGE

##### 1.2 Event plumbing (BRIDGE/VIEW)
- [ ] **EVT-01** Root listeners: keydown, pointerdown, compositionstart, compositionend, input, click, cut, copy, dragstart, dragover, dragend, paste, focus, blur, drop, + beforeinput when supported (L/LexicalEvents.ts:166-187)
- [ ] **EVT-02** Function handlers run only if `editor.isEditable()` or event is `click`; pass-through handlers check editable per-case (copy always) (L/LexicalEvents.ts:1546-1628)
- [ ] **EVT-03** `_lexicalHandled` flag on event prevents parent editors re-handling same DOM event (L/LexicalEvents.ts:1513-1525)
- [ ] **EVT-04** One document-level `selectionchange` listener ref-counted per Document (L/LexicalEvents.ts:1531-1541, 1650-1670)
- [ ] **EVT-05** selectionchange: resolves nearest editor from DOM anchor; previously-active sibling nested editor gets `onSelectionChange(isActive=false)` → `$setSelection(null)`; active nested editor tracked per root editor (L/LexicalEvents.ts:1461-1511)
- [ ] **EVT-06** selectionchange after pointerdown (non touch/pen, button 0, not inside decorator) recreates RangeSelection from DOM (L/LexicalEvents.ts:550-568, 1471-1490)
- [ ] **EVT-07** Skip selectionchange caused by our own DOM-selection update when both endpoints are mid-text-node (L/LexicalEvents.ts:308-326)
- [ ] **EVT-08** Android post-delete: restore saved collapsed selection if browser shifted it right by 1 (same node or into next sibling at offset 1) (L/LexicalEvents.ts:341-362)
- [ ] **EVT-09** Collapsed selection format: within 200ms of `markCollapsedSelectionFormat` at same key/offset reuse recorded format/style; else text anchor → node format/style; element anchor (doc non-empty) → empty element's textFormat/textStyle, else keep format and clear style (L/LexicalEvents.ts:369-420)
- [ ] **EVT-10** Collapsed DOM "Range" with anchorNode===focusNode marks selection dirty (#1482) (L/LexicalEvents.ts:371-376)
- [ ] **EVT-11** Range selection format = bitwise AND of formats of non-empty text nodes, excluding zero-width boundary slices; 0 if none (L/LexicalEvents.ts:421-460)
- [ ] **EVT-12** Click workaround: collapsed element offset 0, single empty top-level block, unchanged selection → `removeAllRanges` + dirty (L/LexicalEvents.ts:513-526)
- [ ] **EVT-13** Click with touch/pen while selection not Range → create RangeSelection from DOM (L/LexicalEvents.ts:526-544)
- [ ] **EVT-14** `$shouldPreventDefaultAndInsertText` — controlled insertion when: anchor≠focus key; anchor not text; replacing a range with 1 grapheme / surrogate pair (non-composing); token/segmented/tab node; dirty node and text length>1; DOM anchor ≠ node's DOM text; targetRange not collapsed / differs from DOM selection; node format/style ≠ selection format/style (not composing); `$shouldInsertTextAfterOrBeforeTextNode` (L/LexicalEvents.ts:222-283)
- [ ] **EVT-15** `$shouldInsertTextAfterOrBeforeTextNode`: segmented → true; non-collapsed → false; offset 0 → !canInsertTextBefore, or parent !canInsertTextBefore (not composing), or token/tab, or previous sibling text/inline-element that !canInsertTextAfter; offset end → mirror (no prev-sibling clause); middle → false (L/LexicalUtils.ts:933-970)
- [ ] **EVT-16** beforeinput `insertText` immediately after a handled Backspace/SelectAll (same tick) is preventDefaulted and collapses to selection end (Chrome macOS text-replacement guard) (L/LexicalEvents.ts:733-746, 662-677)
- [ ] **EVT-17** beforeinput `deleteContentBackward` with null selection uses previous Range selection clone (L/LexicalEvents.ts:748-758)
- [ ] **EVT-18** Android composing backspace: clear composition key, mark anchor dirty, re-clear key after 30ms, no delete dispatch (L/LexicalEvents.ts:764-782)
- [ ] **EVT-19** iOS non-collapsed targetRange on deleteContentBackward (Korean 10-key) → apply DOM range + `removeText` (L/LexicalEvents.ts:801-808)
- [ ] **EVT-20** Android Chrome collapsed same-node backspace (not all-selected, canInsertTextAfter, prev not decorator) lets browser delete; else DELETE_CHARACTER(true) (L/LexicalEvents.ts:810-851)
- [ ] **EVT-21** Double beforeinput (macOS autocorrect+autocapitalize): flush `unprocessedBeforeInputData` via `$updateSelectedTextFromDOM` (L/LexicalEvents.ts:868-870)
- [ ] **EVT-22** beforeinput applies targetRange to clean collapsed non-root selection (L/LexicalEvents.ts:872-879)
- [ ] **EVT-23** insertText with `data==null && dataTransfer` (Safari replacement) → `insertRawText(text/plain)` (L/LexicalEvents.ts:895-899)
- [ ] **EVT-24** insertText not needing control → defer (`unprocessedBeforeInputData = data`), browser mutates DOM, MutationObserver/input reconciles (L/LexicalEvents.ts:913-915)
- [ ] **EVT-25** After controlled insert/replacement, `$maybeMoveSelectionPastTrailingAcceptanceBoundary`: if last key char (or \n/\t) follows caret, skip past it (text, LineBreak, Tab, next block start) (L/LexicalEvents.ts:405-461 viewer; file ~584-640)
- [ ] **EVT-26** All non-insertText beforeinput types are preventDefaulted before switch (L/LexicalEvents.ts:923)
- [ ] **EVT-27** `insertParagraph` beforeinput: clear composition; if preceding keydown was Shift+Enter and not iOS → line break else paragraph (L/LexicalEvents.ts:953-968)
- [ ] **EVT-28** `$canRemoveText`: false only when anchor===focus same token/tab text node (L/LexicalEvents.ts:~642-653)
- [ ] **EVT-29** `$handleInput`: ignore if target inside decorator; if controlled-insert needed: Firefox pending composition end first; dispatch CONTROLLED_TEXT_INSERTION unless DOM already equals expected text; Firefox IME offset fix; Android clears composition; else `$updateSelectedTextFromDOM`; always `$flushMutations` (L/LexicalEvents.ts:1083-1180)
- [ ] **EVT-30** compositionstart (not already composing, Range): set composition key = anchor key, tag COMPOSITION_START_TAG; insert COMPOSITION_START_CHAR (nbsp on Firefox, else nbsp on Safari/iOS / ZWSP elsewhere) if within 30ms of keydown, element anchor, non-collapsed, or format/style mismatch (L/LexicalEvents.ts:1189-1224; L/LexicalConstants.ts:96-108)
- [ ] **EVT-31** compositionend: clear composition key; empty data → re-sync composition node from DOM; data ending "\n" → collapse to focus + KEY_ENTER(null); else `$updateSelectedTextFromDOM(true)`; tag COMPOSITION_END_TAG (L/LexicalEvents.ts:1227-1289)
- [ ] **EVT-32** Safari: compositionend deferred; next keydown Backspace consumes it as composition end (prevents extra char deletion) (L/LexicalEvents.ts:1305-1311, 1330-1343)
- [ ] **EVT-33** keydown ignored entirely while `editor.isComposing()` (L/LexicalEvents.ts:1321-1323)
- [ ] **EVT-34** Keyboard shortcut matching: modifiers exact (false unless 'any'); key compared case-insensitively; non-ASCII layouts fall back to `event.code` (`KeyX`/`DigitN`); multi-char keys never matched by code (L/LexicalUtils.ts:1023-1057)
- [ ] **EVT-35** `CONTROL_OR_META` = meta on Apple, ctrl elsewhere; `CONTROL_OR_ALT` = alt on Apple, ctrl elsewhere (L/LexicalUtils.ts:1059-1060)
- [ ] **EVT-36** `$updateTextNodeFromDOMContent`: strips COMPOSITION_SUFFIX while composing; on composition end strips all COMPOSITION_START_CHARs adjusting offsets; empty text → remove node (deferred 20ms except Safari/iOS); rejects (markDirty to revert DOM) edits to token nodes, stale composition, or insert at non-insertable boundaries; segmented node edited → replaced by plain TextNode (L/LexicalUtils.ts:787-905)

---

#### 2. registerRichText / registerPlainText / dragon

All rich-text handlers at COMMAND_PRIORITY_EDITOR (lexical-rich-text/src/index.ts:651-1376).
- [ ] **RT-01** CLICK: NodeSelection → `clear()` and handled; Range → escape formats for trigger `click` (both); returns false (index.ts:658-676)
- [ ] **RT-02** DELETE_CHARACTER: Range → `deleteCharacter(isBackward)`; NodeSelection → `deleteNodes()`; else false (index.ts:678-691)
- [ ] **RT-03** DELETE_WORD / DELETE_LINE: Range only → `deleteWord`/`deleteLine` (index.ts:693-715)
- [ ] **RT-04** CONTROLLED_TEXT_INSERTION: string → `selection.insertText` (any non-null selection, returns true even if null); event with dataTransfer → `$insertDataTransferForRichText`; event without → Range `insertText(event.data)` if truthy (index.ts:717-744)
- [ ] **RT-05** REMOVE_TEXT: Range → `removeText()` (index.ts:746-756)
- [ ] **RT-06** FORMAT_TEXT: Range → `formatText(format)` (index.ts:758-768)
- [ ] **RT-07** FORMAT_ELEMENT: Range or Node selection; for each selected node, nearest non-inline Element ancestor (inclusive, excluding root) → `setFormat(format)`; returns true (index.ts:770-790)
- [ ] **RT-08** INSERT_LINE_BREAK: Range → `insertLineBreak(selectStart)` (index.ts:792-802)
- [ ] **RT-09** INSERT_PARAGRAPH: Range → `insertParagraph()` (index.ts:804-814)
- [ ] **RT-10** INSERT_TAB: create TabNode with selection format/style (if Range) and `$insertNodes([tab])` (works with any/no selection) (index.ts:816-828)
- [ ] **RT-11** INDENT_CONTENT: `$handleIndentAndOutdent(indent+1)`; OUTDENT: `indent-1` if >0 (index.ts:830-850)
- [ ] **RT-12** `$handleIndentAndOutdent`: Range only; for each selected node nearest non-inline element ancestor (inclusive), dedup by key, apply if `canIndent()`; returns whether any handled (lexical-utils/src/index.ts:690-720)
- [ ] **RT-13** KEY_ARROW_UP: NodeSelection → `nodes[0].selectPrevious()`; Range → if no shift and adjacent node before focus (`$getAdjacentNode(focus, true)`) is non-isolated block decorator → `selectPrevious()` on it (index.ts:852-880)
- [ ] **RT-14** KEY_ARROW_DOWN: NodeSelection → `nodes[0].selectNext(0,0)`; Range at end of root (focus root, offset=childCount) → preventDefault, handled (no-op); else non-isolated block decorator after focus → `selectNext()` (index.ts:882-914)
- [ ] **RT-15** KEY_ARROW_LEFT/RIGHT: NodeSelection → selectPrevious / selectNext(0,0) (swapped if parent RTL); Range: no-shift → escape formats trigger `arrow` (start for left, end for right); if `$shouldOverrideDefaultCharacterSelection` → preventDefault + `$moveCharacter` (index.ts:916-992)
- [ ] **RT-16** `$shouldOverrideDefaultCharacterSelection`: direction flipped for vertical writing mode and RTL; false if focus caret is extendable within text; else walk range: first ChildCaret → !inline; Element sibling → continue; Decorator → true (lexical-selection/src/range-selection.ts:473-503)
- [ ] **RT-17** `$moveCharacter` → `selection.modify(shift?'extend':'move', adjusted, 'character')` with RTL/vertical inversion (range-selection.ts:539-570) — needs DOM except decorator/block cases
- [ ] **RT-18** KEY_BACKSPACE: target inside decorator → false; Range collapsed at front (offset 0, anchor is block or its first descendant) of indented block → preventDefault + OUTDENT; iOS ko-KR → false (native); non-Range non-Node → false; else preventDefault + DELETE_CHARACTER(true) (index.ts:994-1018, 536-556)
- [ ] **RT-19** KEY_DELETE: target inside decorator → false; Range/Node → preventDefault + DELETE_CHARACTER(false) (index.ts:1020-1033)
- [ ] **RT-20** KEY_ENTER: NodeSelection of exactly one block decorator → convert to Range via `selectNext()`; non-Range → false; escape formats trigger `enter`; if event: on iOS/Safari/AppleWebKit with beforeinput → return false (native → beforeinput insertParagraph); preventDefault; shift → INSERT_LINE_BREAK(false); else INSERT_PARAGRAPH (null event → paragraph) (index.ts:1035-1088)
- [ ] **RT-21** KEY_ESCAPE: Range → `editor.blur()` (DOM blur + removeAllRanges) (index.ts:1090-1100) — VIEW
- [ ] **RT-22** DROP: files present → caretFromPoint → set collapsed selection at drop point (text: offset in node; other: after node in parent), normalize, dispatch DRAG_DROP_PASTE(files), preventDefault; else `$handleRichTextDrop` (index.ts:1102-1136)
- [ ] **RT-23** `$doDrop` (drop of Lexical-originated drag only, marker MIME `application/x-lexical-drag` `{editorKey}`): resolve drop caret, split at it; same editor: require non-collapsed Range, drop inside selection → no-op handled, else `removeText()` source; abort if split origin detached; set collapsed selection at drop caret, insert dataTransfer; cross-editor: dispatch synthetic `beforeinput deleteByDrag` on source root; preventDefault (lexical-clipboard/src/clipboard.ts:260-355)
- [ ] **RT-24** Non-Lexical drags fall through (false) to native drop → beforeinput insertFromDrop → CONTROLLED_TEXT_INSERTION (clipboard.ts:274-281)
- [ ] **RT-25** DRAGSTART: file transfer w/o Range → false; non-collapsed Range → write `application/x-lexical-editor` clipboard data + drag marker; returns true (index.ts:1138-1164)
- [ ] **RT-26** DRAGOVER: file transfer w/o Range → false; preventDefault when hovering decorator (show caret); true (index.ts:1166-1187) — VIEW
- [ ] **RT-27** SELECT_ALL: `$selectAll()` (index.ts:1189-1196; L/LexicalUtils.ts:1231-1250)
- [ ] **RT-28** `$selectAll(selection?)`: given Range → anchor (topLevelParent's parent, 0) / focus (same, childCount) then normalize; else root.select(0, childCount) normalized and set (L/LexicalUtils.ts:1231-1250) — **AMBIGUOUS** rich SELECT_ALL calls `$selectAll()` with no arg, so it always selects whole root even inside a shadow root
- [ ] **RT-29** COPY: `copyToClipboard(editor, ClipboardEvent|null)`; true (index.ts:1198-1207)
- [ ] **RT-30** CUT: await copy, then update: Range → `removeText()`; NodeSelection → remove each node (index.ts:478-494, 1209-1215)
- [ ] **RT-31** PASTE: files and no text/html|text/plain → DRAG_DROP_PASTE; target in decorator input/textarea/foreign contenteditable → false; any selection → preventDefault + update tagged PASTE_TAG → `$insertDataTransferForRichText(clipboardData)` (InputEvent/KeyboardEvent → no clipboardData → no-op) (index.ts:461-482, 1217-1242)
- [ ] **RT-32** Rich import MIME priority: `application/x-lexical-editor`(0) → `text/html`(10) → `text/plain`(20) → `text/uri-list`(30) (lexical-clipboard/src/ClipboardImportExtension.ts:159-164)
- [ ] **RT-33** KEY_SPACE / KEY_TAB: Range → escape formats for trigger `space`/`tab` (both); return false (index.ts:1244-1278)
- [ ] **RT-34** Rich text does NOT register KEY_TAB→indent; that is TabIndentationExtension (see RT-45)
- [ ] **RT-35** MOVE_TO_END: Range anchor element offset 0, first child inline decorator, last descendant non-decorator → `element.selectEnd()` (shift keeps anchor at element 0), preventDefault+stopPropagation (index.ts:1280-1316)
- [ ] **RT-36** MOVE_TO_START: focus block's first child inline decorator, last descendant non-decorator, anchor in same block, focus not already at (block,0) → focus=(block,0), anchor too unless shift (index.ts:1318-1373)
- [ ] **RT-37** Escape-format triggers config: default `capitalize|lowercase|uppercase: {enter, space, tab}`; per format `TriggerConfig{enter,click,arrow,space,tab,onlyAtBoundary}` or null to disable (index.ts:568-649)
- [ ] **RT-38** `$escapeFormatsForTrigger`: boundary = collapsed text point at end with no next sibling / start with no prev sibling per direction; for each format with trigger: if `onlyAtBoundary` require boundary and anchor node has the format; toggle selection format off if set; if any boundary escape happened clear selection style (index.ts:592-643)
- [ ] **RT-39** QuoteNode: type `quote`, `<blockquote>`; insertNewAfter → new Paragraph (copies direction) after; `collapseAtStart` → replace with paragraph holding children; `canMergeWhenEmpty` true (index.ts:133-211)
- [ ] **RT-40** HeadingNode: type `heading`, `tag` h1–h6 (default h1), serialized `tag`; `updateDOM` recreates on tag change (index.ts:226-413)
- [ ] **RT-41** Heading insertNewAfter: at end (anchor at end of last descendant, or empty, or no selection) → Paragraph else same-tag Heading; copies direction; if anchor offset 0 and heading non-empty → heading `replace(paragraph, true)` (children moved) and paragraph selected; combined with insertParagraph moving children into the new block, net effect of Enter at start of heading = empty paragraph inserted before, heading content kept as heading (index.ts:367-389; L/LexicalSelection.ts:1463-1488)
- [ ] **RT-42** Heading collapseAtStart: if empty → replace with paragraph (children moved); always returns true (index.ts:391-399)
- [ ] **RT-43** Heading `extractWithChild` → true (index.ts:401-403)
- [ ] **RT-44** Heading importDOM: h1–h6 → heading (indent/format/direction from DOM); Google Docs title span (font-size 26pt) → h1, wrapping `<p>` dropped (priority 3) (index.ts:262-306, 415-439)
- [ ] **RT-45** TabIndentation: KEY_TAB (Range only, preventDefault) → if selection spans canIndent block nodes or first point is at start of a canIndent block → shift?OUTDENT:INDENT else INSERT_TAB (shift+Tab mid-text inserts tab); INDENT at CRITICAL priority honors `$canIndent` and `maxIndent` (only sets if `newIndent < maxIndent`) (lexical-extension/src/TabIndentationExtension.ts:40-130)

Plain text (lexical-plain-text/src/index.ts:120-414), all EDITOR priority:
- [ ] **PT-01** DELETE_CHARACTER/WORD/LINE: Range only (no NodeSelection delete) (index.ts:122-166)
- [ ] **PT-02** CONTROLLED_TEXT_INSERTION: Range only; string → insertText; dataTransfer → `$insertDataTransferForPlainText` (text/plain || text/uri-list → `insertRawText`); else insertText(data) (index.ts:167-191; clipboard.ts:129-139)
- [ ] **PT-03** REMOVE_TEXT: Range → removeText (index.ts:193-204)
- [ ] **PT-04** INSERT_LINE_BREAK: Range → insertLineBreak(selectStart) (index.ts:205-216)
- [ ] **PT-05** INSERT_PARAGRAPH: Range → `insertLineBreak()` (no paragraphs in plain text) (index.ts:217-228)
- [ ] **PT-06** KEY_ARROW_LEFT/RIGHT: Range + `$shouldOverrideDefaultCharacterSelection` → `$moveCharacter` (no escape-format, no NodeSelection handling) (index.ts:229-268)
- [ ] **PT-07** KEY_BACKSPACE: Range; iOS ko-KR → false; preventDefault + DELETE_CHARACTER(true) (no outdent) (index.ts:269-287)
- [ ] **PT-08** KEY_DELETE: Range → DELETE_CHARACTER(false) (index.ts:288-299)
- [ ] **PT-09** KEY_ENTER: Range; event + iOS/Safari/WebKit w/ beforeinput → false; preventDefault; always INSERT_LINE_BREAK(false) (index.ts:300-327)
- [ ] **PT-10** SELECT_ALL → `$selectAll()` (index.ts:328-335)
- [ ] **PT-11** COPY (Range only): if clipboardData and non-collapsed → preventDefault, set text/html (`$getHtmlContent`) and text/plain (`selection.getTextContent()`) (index.ts:56-84, 336-347)
- [ ] **PT-12** CUT: copy then removeText (Range) (index.ts:105-118, 348-359)
- [ ] **PT-13** PASTE: Range; preventDefault; PASTE_TAG update; only ClipboardEvent clipboardData → plain insert (index.ts:86-103, 360-371)
- [ ] **PT-14** DROP → `$handlePlainTextDrop` (same as RT-23 with plain insert); DRAGSTART: Range non-collapsed → write drag marker only (index.ts:372-392)
- [ ] **PT-15** No handlers for CLICK, FORMAT_TEXT, FORMAT_ELEMENT, INDENT/OUTDENT, INSERT_TAB, ARROW_UP/DOWN, ESCAPE, SPACE, TAB, DRAGOVER, MOVE_TO_* in plain text
- [ ] **PT-16** PlainTextExtension conflicts with rich-text; depends on Dragon, NormalizeInlineElements, NormalizeTripleClickSelection (index.ts:420-430)

Dragon (lexical-dragon/src/index.ts:17-148) — VIEW/BRIDGE:
- [ ] **DRG-01** window `message` listener (capture); ignore other origins or when root not `document.activeElement` (index.ts:18-27)
- [ ] **DRG-02** accepts JSON string `{protocol:'nuanria_messaging', type:'request', payload:{functionId:'makeChanges', args:[elementStart, elementLength, text, selStart, selLength, formatCommand]}}` (index.ts:29-55)
- [ ] **DRG-03** in update with Range: if anchor text node and start/len ≥0 → set text range [start, start+len) on anchor node; if range non-empty or text non-empty → `insertRawText(text)`; then set final selection [selStart, selStart+selLength) clamped to node length on the (new) anchor text node; `stopImmediatePropagation` (index.ts:60-118)
- [ ] **DRG-04** formatCommand ignored (TODO) (index.ts:57-58)
- [ ] **DRG-05** DragonExtension disabled by default when no `window` (index.ts:133-148)

---

#### 3. Core model normalization, nodes, updates, listeners

##### 3.1 Text normalization
- [ ] **NRM-01** `$normalizeTextNode` applies only to text nodes that are simple (`__type==='text'` && mode normal) and not unmergeable (L/LexicalNormalization.ts:47-90; L/nodes/LexicalTextNode.ts:463-465)
- [ ] **NRM-02** Empty simple mergeable text node is removed (L/LexicalNormalization.ts:50-53)
- [ ] **NRM-03** Backward: while prev sibling is simple mergeable text: empty → remove and continue; mergeable → merge (prev absorbs node) and stop; else stop (L/LexicalNormalization.ts:55-72)
- [ ] **NRM-04** Forward: same with next sibling; merge into current (L/LexicalNormalization.ts:74-90)
- [ ] **NRM-05** Mergeable iff same mode, format, style, and NodeState equivalent (`nodeStatesAreEquivalent`) — detail not compared (L/LexicalNormalization.ts:16-36)
- [ ] **NRM-06** **AMBIGUOUS** `=== null` checks on `__mode/__format/__style/__state` are dead (fields never null; `__state` is undefined) — effective rule is strict equality + state equivalence (L/LexicalNormalization.ts:29-35)
- [ ] **NRM-07** Merge = `mergeWithSibling`: concat text, move composition key to survivor, shift selection points on removed node (text: +len if target after; element offsets > target index decrement), remove target; both keys added to `_normalizedNodes` (L/LexicalNormalization.ts:38-45; L/nodes/LexicalTextNode.ts:1136-1189; L/LexicalSelection.ts:3038-3050)
- [ ] **NRM-08** Normalization runs over dirty leaves at start of each transform pass; with `skipTransforms` only normalization runs (L/LexicalUpdates.ts:224-243, 291-300, 1022-1026)
- [ ] **NRM-09** Subclasses (TabNode, custom text types) never merge/normalize because `isSimpleText` checks `__type==='text'` (L/nodes/LexicalTextNode.ts:463)

##### 3.2 Selection normalization
- [ ] **NRM-10** `$normalizeSelection` (exported `$normalizeSelection__EXPERIMENTAL`): each element point descends: offset==childCount → last child at end, else child at offset at start; text child → text point (0 or size) and stop; element child → continue descending; decorator/linebreak → stop (L/LexicalNormalization.ts:92-132; L/index.ts:229)

##### 3.3 Element semantics (`L/nodes/LexicalElementNode.ts`)
- [ ] **EL-01** Fields: first/last/size (linked children), format (alignment int), style, indent, dir ('ltr'|'rtl'|null), textFormat, textStyle (EL:85-132)
- [ ] **EL-02** Alignment map: left=1 center=2 right=3 justify=4 start=5 end=6, ''=0; `setFormat` unknown → 0 (L/LexicalConstants.ts:61-66; EL:434-438)
- [ ] **EL-03** `getTextContent`: concat children, add "\n\n" after each non-inline element child except last (EL:294-311)
- [ ] **EL-04** `canBeEmpty` default true; when false: `select(0,0)`/`select()` delegate to first/last text|element child; element auto-removed when it becomes empty via child removal (`$removeNode`) or splice-delete with Range selection, unless root/shadow root (EL:367-388, 586-589; L/LexicalNode.ts:331-338)
- [ ] **EL-05** `isInline` default false; inline elements must have `canBeEmpty()=false` (EL:728-730)
- [ ] **EL-06** `canInsertTextBefore/After` default true; false makes insertText at boundaries create/use sibling text outside parent (SEL-12/13)
- [ ] **EL-07** `excludeFromCopy(destination?: 'clone'|'html')` default false; used by DOM export `$shouldExclude` (EL:703-705; L/LexicalEditor.ts:766-767)
- [ ] **EL-08** `isShadowRoot` default false; shadow roots bound `getTopLevelElement`, `$isRootOrShadowRoot`, forward-deletion guard, caret rootMode 'shadowRoot', and are never INTERNAL_$isBlock (EL:735-737; L/LexicalUtils.ts:1618-1623, 2006-2024)
- [ ] **EL-09** `canIndent` default true (EL:686)
- [ ] **EL-10** `canMergeWith` deprecated, default false; `canReplaceWith`/`canInsertAfter` deprecated true (EL:707-741)
- [ ] **EL-11** `collapseAtStart(selection)` default false; called on backspace at offset 0 walking up while each node has no previous sibling until root/shadow root; true stops deletion (EL:700; L/LexicalSelection.ts:2041-2063)
- [ ] **EL-12** `extractWithChild(child, selection, destination)` default false; true means include this ancestor when exporting a partially selected child (EL:742-748; L/LexicalEditor.ts:762-764)
- [ ] **EL-13** `canMergeWhenEmpty` default false; true (Quote/ListItem) lets insertNodes merge first inserted block into this empty block (EL:763-765; L/LexicalSelection.ts:1416-1420)
- [ ] **EL-14** `insertNewAfter(selection, restoreSelection)` default null (no split) (EL:680-685)
- [ ] **EL-15** `splice(start, deleteCount, nodes)`: asserts bounds and non-ephemeral; removes nodes from old parents; inserting self throws; adjusts selection off removed points to sibling (`moveSelectionPointToSibling`) (EL:459-604)
- [ ] **EL-16** `append/clear/select/selectStart/selectEnd` (selectStart → first descendant selectStart else select(); selectEnd mirror) (EL:412-428)
- [ ] **EL-17** exportJSON: `{children:[], direction, format(type string), indent, type, version, ...state}`; `textFormat`/`textStyle` only if non-default, not root/shadow, and no TextNode children (EL:639-667)
- [ ] **EL-18** updateFromJSON sets format, indent, direction, textFormat||0, textStyle||'' (EL:668-678)
- [ ] **EL-19** exportDOM: indent>0 → `padding-inline-start: indent*40px` + `data-lexical-indent`; `dir` (EL:611-637)
- [ ] **EL-20** `INTERNAL_$isBlock`: block decorator, or non-inline, non-root/shadow element with `canBeEmpty()!==false` whose first child is null/LineBreak/Text/inline (L/LexicalUtils.ts:2006-2024)
- [ ] **EL-21** **AMBIGUOUS** element `textFormat/textStyle` are updated by the *reconciler* from first text descendant (VIEW mutating MODEL); headless editors (no root element) skip reconcile, so these won't track (L/LexicalReconciler.ts:637-655, 677-678)

##### 3.4 Text node semantics (`L/nodes/LexicalTextNode.ts`)
- [ ] **TX-01** Fields text, format (bitmask), style (CSS string), mode (0 normal,1 token,2 segmented; 3 inert reserved), detail (bitmask) (TX:312-355; L/LexicalConstants.ts:30-34)
- [ ] **TX-02** Detail bits: directionless=1, unmergeable=2 (L/LexicalConstants.ts:57-58)
- [ ] **TX-03** **AMBIGUOUS** `TextDetailType = 'directionless'|'unmergable'` (typo) while map key is `'unmergeable'`; `setDetail('unmergable')` yields undefined (TX:91; L/LexicalConstants.ts:131-134)
- [ ] **TX-04** token mode: atomic — any non-empty partial selection removes whole node; insertText at its boundaries goes to sibling; typing inside replaces it; DOM edits reverted (SEL-11..16; CARET-30; EVT-36)
- [ ] **TX-05** segmented mode: delete removes a whitespace-delimited segment (`$removeSegment`); edits convert it to plain normal TextNode; split produces normal-mode nodes (L/LexicalSelection.ts:2234-2272; TX:1037-1045)
- [ ] **TX-06** `isComposing` = key equals composition key (TX:410)
- [ ] **TX-07** `canInsertTextBefore/After` default true; `isTextEntity` false; `canHaveFormat` true; `isInline` true (TX:492-503, 948-964, 1191)
- [ ] **TX-08** `setTextContent` no-op if equal; `setMode` no-op if equal (TX:812-845)
- [ ] **TX-09** `spliceText(offset, del, text, moveSelection)`: negative offset counts from... **AMBIGUOUS** uses `newText.length + offset` (not text length) for negative index (TX:907-946)
- [ ] **TX-10** `splitText(...offsets)`: sorted, empty text → []; one part → [self]; first part reuses self (segmented: replaced by new plain node), others new `$createTextNode` copying format/style/detail/state (not subclass type, not mode); composition key follows to last part; selection points remapped (end left-biased; start moves forward only if end lands later); parent splice + element-point selection shift (TX:971-1134)
- [ ] **TX-11** **AMBIGUOUS** split siblings are created with `$createTextNode` → base TextNode (or its replacement), losing subclass type and mode (TX:1060-1066)
- [ ] **TX-12** `select(a?,f?)` defaults to end; existing Range reused (moves composition key if it was on old points) else new dirty Range (TX:846-885)
- [ ] **TX-13** exportJSON `{detail, format, mode(string), style, text, type, version, ...state}` (TX:699-712)
- [ ] **TX-14** `selectionTransform(prev, next)` hook called each update for anchor/focus text nodes (TX:714-719; L/LexicalSelection.ts:2972-2995)
- [ ] **TX-15** exportDOM wraps b/i/s/u, `white-space: pre-wrap`, text-transform for case formats (TX:661-697)

##### 3.5 Format bitmask
- [ ] **FMT-01** bold=1, italic=2, strikethrough=4, underline=8, code=16, subscript=32, superscript=64, highlight=128, lowercase=256, uppercase=512, capitalize=1024; IS_ALL_FORMATTING = OR of all (L/LexicalConstants.ts:37-55)
- [ ] **FMT-02** `toggleTextFormatType(format, type, alignWith)`: if alignWith given and bit already equals alignWith's bit → unchanged; else XOR bit (L/LexicalUtils.ts:283-311)
- [ ] **FMT-03** subscript clears superscript and vice versa (after toggle) (L/LexicalUtils.ts:296-299)
- [ ] **FMT-04** lowercase/uppercase/capitalize mutually exclusive: toggling one clears other two (L/LexicalUtils.ts:300-309)
- [ ] **FMT-05** TextFormatType strings: bold, underline, strikethrough, italic, highlight, code, subscript, superscript, lowercase, uppercase, capitalize (TX:93-104)

##### 3.6 LineBreak / Tab / Paragraph / Root / Decorator / Artificial
- [ ] **NODE-01** LineBreakNode: type `linebreak`, text "\n", inline, `<br>`, JSON only type/version(+state) (L/nodes/LexicalLineBreakNode.ts)
- [ ] **NODE-02** `<br>` import skipped if only child or last child of a block DOM node (ignoring whitespace text) (LexicalLineBreakNode.ts importDOM, isOnlyChildInBlockNode, isLastChildInBlockNode)
- [ ] **NODE-03** TabNode: type `tab`, extends TextNode, text always "\t", detail fixed UNMERGEABLE, mode normal only; setTextContent forces "\t" (dev-assert '\t'|''); spliceText only (''/0) or ('\t'/1) else throws; setDetail/setMode other values throw; canInsertTextBefore/After false; no importDOM (L/nodes/LexicalTabNode.ts)
- [ ] **NODE-04** ParagraphNode: type `paragraph`, `<p>`; JSON always includes textFormat/textStyle (from first TextNode child, else element's own) (L/nodes/LexicalParagraphNode.ts exportJSON)
- [ ] **NODE-05** Paragraph insertNewAfter: new paragraph with textFormat/textStyle = selection format/style, copies direction, alignment format, style (LexicalParagraphNode.ts insertNewAfter)
- [ ] **NODE-06** Paragraph collapseAtStart: if no children or first child is text whose trimmed content is empty → select next sibling (else previous) and remove self, true; else false (LexicalParagraphNode.ts collapseAtStart)
- [ ] **NODE-07** Paragraph importDOM `<p>`: format from CSS text-align, fallback legacy `align` attr, indent, direction (LexicalParagraphNode.ts $convertParagraphElement)
- [ ] **NODE-08** RootNode: key 'root', type `root`; remove/replace/insertBefore/insertAfter throw; splice only accepts Element or Decorator children; `getTopLevelElementOrThrow` throws; importJSON updates existing root; collapseAtStart true; cached text used when read-only or nothing dirty (L/nodes/LexicalRootNode.ts)
- [ ] **NODE-09** Inserting non-element/non-decorator next to a root child (insertAfter/insertBefore/replace) throws (L/LexicalUtils.ts:1697-1712)
- [ ] **NODE-10** EditorState is never empty: `setEditorState` with only root & no selection throws (L/LexicalEditor.ts:1537-1543)
- [ ] **NODE-11** DecoratorNode: `decorate()` null default, `isIsolated` false, `isInline` true default, `isKeyboardSelectable` true (L/nodes/LexicalDecoratorNode.ts)
- [ ] **NODE-12** Block decorator (isInline false) may be a root child; arrow up/down select around it (RT-13/14); deletion next to it selects it (NodeSelection) if anchor block empty else removes it (SEL-40); isolated decorators are never deleted by deleteCharacter and skipped by arrow overrides
- [ ] **NODE-13** Decorators GC: decorators map entries removed when key leaves node map; decorator listeners fire with new map (L/LexicalGC.ts:17-36; L/LexicalUpdates.ts:691-696)
- [ ] **NODE-14** ArtificialNode__DO_NOT_USE type `artificial` always registered (L/nodes/ArtificialNode.ts; L/LexicalEditor.ts:789-796)
- [ ] **NODE-15** Always-registered nodes: Root, Text, LineBreak, Tab, Paragraph, Artificial + config.nodes (L/LexicalEditor.ts:789-797)
- [ ] **NODE-16** `LexicalNode.isInline()` base throws if not implemented (L/LexicalNode.ts:659-665)
- [ ] **NODE-17** `isParentRequired` false / `createParentElementNode` → Paragraph; used by insertNodes wrapping (L/LexicalNode.ts:1565-1575; L/LexicalSelection.ts:3432-3476)
- [ ] **NODE-18** `selectPrevious/selectNext`: element sibling → select inside (end / start); non-text leaf → parent element point around it; text → select(offsets); none → parent select(0,0) / select() (L/LexicalNode.ts:1591-1632)
- [ ] **NODE-19** `remove(preserveEmptyParent?)`: moves selection off removed node to sibling, NodeSelection on it → selectPrevious; removes empty non-canBeEmpty parents recursively (unless preserve); empty root → selectEnd (L/LexicalNode.ts:277-345)
- [ ] **NODE-20** `replace(node, includeChildren?)`: keeps position, optional child transfer (element points remapped to prevSize+offset), other points on replaced node move to end of replacement; composition key follows (L/LexicalNode.ts:1308-1422)

##### 3.7 Node identity, cloning, replacement
- [ ] **ID-01** `getLatest()` resolves by key in active state; throws if missing; ephemeral nodes return self (L/LexicalNode.ts:1074-1088)
- [ ] **ID-02** `getWritable()`: read-only → throws; clones once per update (`_cloneNotNeeded`), marks dirty, invalidates selection cached nodes (L/LexicalNode.ts:1094-1122)
- [ ] **ID-03** Mark dirty: element → `dirtyElements.set(key,true)` (intentional), leaf → `dirtyLeaves`; all ancestors marked unintentionally (false); `_dirtyType` NO→HAS (never downgrades FULL) (L/LexicalUtils.ts:472-499)
- [ ] **ID-04** `$cloneWithProperties` = `klass.clone(node)` + `afterCloneFrom`; same key; dev asserts key & links preserved (L/LexicalUtils.ts:2167-2189)
- [ ] **ID-05** `afterCloneFrom`: same key → copy parent/prev/next/state; different key → writable copy of state (L/LexicalNode.ts:607-616)
- [ ] **ID-06** `$copyNode(node, skipReset=false)`: clone, assign new key, afterCloneFrom, then `resetOnCopyNodeFrom` (resets NodeState values with `resetOnCopyNode`) unless skipReset; no children/links (L/LexicalUtils.ts:1635-1646; L/LexicalNode.ts:623-627)
- [ ] **ID-07** `$cloneWithPropertiesEphemeral`: detached clone whose getLatest/getWritable return self; cannot be marked dirty or spliced (L/LexicalUtils.ts:2202-2206; L/LexicalNode.ts:444-460)
- [ ] **ID-08** Node replacement config `{replace, with, withKlass?}`; `$applyNodeReplacement` (used by every `$createX`) calls `with(node)`; asserts result instanceof withKlass (or strict subclass of original if none) and has a new key (L/LexicalUtils.ts:1648-1695; L/LexicalEditor.ts:231-253)
- [ ] **ID-09** Dev warning when `replace` without `withKlass`; `withKlass` must extend replaced class (L/LexicalEditor.ts:826-842)
- [ ] **ID-10** Transforms & mutation listeners registered on replaced class also apply to `withKlass` (resolved transitively) (L/LexicalEditor.ts:1240-1340)
- [ ] **ID-11** `$create(klass)`: constructs final resolved replacement klass directly with no args, ignoring `with` (L/LexicalUtils.ts:2439-2446)
- [ ] **ID-12** Node type strings must be unique per editor; unknown type on parse throws (L/LexicalUpdates.ts:382-395)

##### 3.8 Transforms
- [ ] **TF-01** `registerNodeTransform(klass, fn)` adds to registered node (and withKlass); immediately marks all existing nodes of that type dirty via `editor.update` tagged HISTORY_MERGE_TAG (if no pending state) (L/LexicalEditor.ts:1323-1350; L/LexicalUtils.ts:610-648)
- [ ] **TF-02** Static `transform()` and `$config().$transform` collected up the class chain (each class's own), applied for subclasses too (L/LexicalEditor.ts:713-745)
- [ ] **TF-03** Per node: run its type's transforms in order, stop once node detached (L/LexicalUpdates.ts:187-210)
- [ ] **TF-04** Nodes skipped if detached or composing (L/LexicalUpdates.ts:212-222)
- [ ] **TF-05** Loop: process dirty leaves (normalize then transform); if new dirty leaves → repeat leaves; then elements intentionally dirty only, root moved last ("finalizer"); repeat until no new dirty leaves/elements (L/LexicalUpdates.ts:269-364)
- [ ] **TF-06** Infinite guard: `infiniteTransformCount` incremented per pass; checked on every markDirty, throws when >99; reset in finally of each update (L/LexicalUpdates.ts:73, 94-101, 319, 359, 1089)
- [ ] **TF-07** Transforms are skipped entirely with `skipTransforms` (normalization still runs) (L/LexicalUpdates.ts:1021-1026)
- [ ] **TF-08** Update-listener cascade guard: >99 chained enqueued updates → error via onError, queue dropped (L/LexicalUpdates.ts:858-885)

##### 3.9 Update lifecycle
- [ ] **UPD-01** `editor.update(fn, opts)`: if already updating → queued (run within the same pending state), else `$beginUpdate` (L/LexicalUpdates.ts:1134-1144)
- [ ] **UPD-02** Begin: clone pending/current state if none or read-only; create selection (headless: clone current; DOM: from DOM/previous per event type) (L/LexicalUpdates.ts:957-1016; L/LexicalSelection.ts:2671-2800)
- [ ] **UPD-03** Order: fn → nested queued updates → selection transforms → normalize/transforms → nested updates again → GC detached nodes (L/LexicalUpdates.ts:1017-1035)
- [ ] **UPD-04** After update: Range selection anchor/focus must exist in node map else throw ("selection has been lost"); empty NodeSelection → null (L/LexicalUpdates.ts:1043-1065)
- [ ] **UPD-05** Error in update → onError, revert pending to current state with FULL_RECONCILE, commit (L/LexicalUpdates.ts:1066-1083)
- [ ] **UPD-06** Commit if dirty nodes, deferred callbacks, or selection changed; `discrete` (or composition key change) → synchronous commit, else microtask; no-op update clears tags/deferred (L/LexicalUpdates.ts:1092-1114)
- [ ] **UPD-07** Options: `onUpdate` (pushed to deferred, runs after commit), `skipTransforms`, `tag` (string|string[] merged into `_updateTags`), `discrete` (sync commit; nested discrete sets `_flushSync`), internal `event` (L/LexicalEditor.ts:110-133; L/LexicalUpdates.ts:907-955)
- [ ] **UPD-08** `$onUpdate(fn)` appends to deferred; `$addUpdateTag`/`$hasUpdateTag` (L/LexicalUtils.ts:1513-1535)
- [ ] **UPD-09** Commit: state becomes current & read-only; reconcile DOM if dirty & root; reset dirty sets/tags; GC decorators; update DOM selection unless SKIP_DOM_SELECTION_TAG / not editable; mutation listeners; SELECTION_CHANGE for non-Range selection changes; decorator listeners; text-content listeners (only if text changed); update listeners; deferred callbacks; next enqueued update (L/LexicalUpdates.ts:521-732)
- [ ] **UPD-10** Reconcile error → reset editor and retry full reconcile once with recovery prev state; second failure throws (L/LexicalUpdates.ts:574-600)
- [ ] **UPD-11** `editor.read(fn)` commits pending first, then read-only (L/LexicalEditor.ts:1617-1620)
- [ ] **UPD-12** `editorState.read(fn, {editor?})` read-only; mutations throw (`errorOnReadOnly`) (L/LexicalEditorState.ts:121-127; L/LexicalUpdates.ts:81-92)
- [ ] **UPD-13** `setEditorState(state, {tag})`: commits pending first, clones if read-only (selection cloned), FULL_RECONCILE, root dirty (unintentional), clears composition, commits unless updating (L/LexicalEditor.ts:1537-1590)
- [ ] **UPD-14** `parseEditorState(json|string, fn?)`: fresh state, isolated dirty sets, parse root recursively (importJSON then append children), run fn, read-only; errors → onError (L/LexicalUpdates.ts:422-477; L/LexicalEditor.ts:1592-1601)
- [ ] **UPD-15** `editor.focus(cb, {defaultSelection:'rootStart'|'rootEnd'})`: re-dirty existing selection, else select root end/start; tag FOCUS_TAG; autocapitalize off during (L/LexicalEditor.ts:1635-1674) — VIEW
- [ ] **UPD-16** `editor.blur()` DOM blur + clear DOM selection (L/LexicalEditor.ts:1676-1690) — VIEW
- [ ] **UPD-17** `GC`: detached dirty elements (and their subtree) and detached dirty leaves deleted from node map; nodes created & detached this update dropped from dirty sets (L/LexicalGC.ts:72-125)

##### 3.10 Update tags (`L/LexicalUpdateTags.ts`)
- [ ] **TAG-01** `HISTORIC_TAG='historic'` update from undo/redo
- [ ] **TAG-02** `HISTORY_PUSH_TAG='history-push'` force new history entry
- [ ] **TAG-03** `HISTORY_MERGE_TAG='history-merge'` merge into previous history entry (used by transform registration)
- [ ] **TAG-04** `PASTE_TAG='paste'` paste update
- [ ] **TAG-05** `COLLABORATION_TAG='collaboration'` remote collab update
- [ ] **TAG-06** `SKIP_COLLAB_TAG='skip-collab'` don't sync to collab
- [ ] **TAG-07** `SKIP_SCROLL_INTO_VIEW_TAG='skip-scroll-into-view'`
- [ ] **TAG-08** `SKIP_DOM_SELECTION_TAG='skip-dom-selection'` don't touch DOM selection/focus at commit (L/LexicalUpdates.ts:636-647)
- [ ] **TAG-09** `SKIP_SELECTION_FOCUS_TAG='skip-selection-focus'` change DOM selection without focusing (ignored if SKIP_DOM_SELECTION)
- [ ] **TAG-10** `FOCUS_TAG='focus'` from editor.focus()
- [ ] **TAG-11** `COMPOSITION_START_TAG='composition-start'`, `COMPOSITION_END_TAG='composition-end'`
- [ ] **TAG-12** Internal tag `'registerMutationListener'` on initial mutation listener call (L/LexicalEditor.ts:1310-1314)
- [ ] **TAG-13** Tags accumulate across all updates batched into one commit (L/LexicalEditor.ts:432-437)

##### 3.11 Listeners
- [ ] **LST-01** registerUpdateListener: payload {dirtyElements, dirtyLeaves, editorState, mutatedNodes (null if DOM not reconciled; only computed if any mutation listener exists), normalizedNodes, prevEditorState, tags}; fires on every commit (L/LexicalEditor.ts:391-444, 1092)
- [ ] **LST-02** Listener return value (function) is stored and invoked as cleanup before the next call / on unregister (L/LexicalUpdates.ts:772-801; L/LexicalEditor.ts:1039-1066)
- [ ] **LST-03** registerTextContentListener(text): fires only when root text content changed (L/LexicalUpdates.ts:734-745)
- [ ] **LST-04** registerMutationListener(klass, fn, {skipInitialization=false}): Map<key,'created'|'updated'|'destroyed'> per class + {dirtyLeaves, prevEditorState, updateTags}; initial call with all existing nodes 'created'; klass resolved through replacements (L/LexicalEditor.ts:1248-1320; L/LexicalUpdates.ts:747-770)
- [ ] **LST-05** Mutations computed by reconciler (VIEW): headless editors produce no mutation events (L/LexicalUpdates.ts:547-573) — **AMBIGUOUS** for headless Rust port
- [ ] **LST-06** registerRootListener(root, prevRoot): called immediately with (current, null); on unregister called with (null, current) (L/LexicalEditor.ts:1147-1158)
- [ ] **LST-07** registerEditableListener: fires only on change via `setEditable`; not called initially (L/LexicalEditor.ts:1105, 1701-1706)
- [ ] **LST-08** `setEditable(b)` no-op if unchanged; while not editable DOM selection not updated at commit, events except click/copy ignored (L/LexicalUpdates.ts:636-638; L/LexicalEvents.ts:1553-1580)
- [ ] **LST-09** registerDecoratorListener fires when pending decorators map committed (L/LexicalUpdates.ts:691-696)

##### 3.12 JSON
- [ ] **JSON-01** Base exportJSON `{type, version: 1, ...nodeStateJSON}` (L/LexicalNode.ts:1216-1223)
- [ ] **JSON-02** `SerializedEditorState = {root: SerializedRootNode}` — no top-level version field; versioning only per-node `version` (always 1 in core) (L/LexicalEditorState.ts:23-27)
- [ ] **JSON-03** Export asserts exported `type` equals class type and elements have `children` array; children appended recursively (L/LexicalEditorState.ts:57-93)
- [ ] **JSON-04** `$parseSerializedNode(json)` parses a subtree in active editor (L/LexicalUpdates.ts:372-420)
- [ ] **JSON-05** Parse asserts `json.type === klass.getType()` (else "does not implement importJSON") (L/LexicalUpdates.ts:398-405)
- [ ] **JSON-06** `updateFromJSON(json)` base applies NodeState from `$` and flat keys; subclasses chain setters; `LexicalUpdateJSON` omits children/type/version (L/LexicalNode.ts:240-243, 1268-1272)
- [ ] **JSON-07** Default importJSON (via $config) = `new klass().updateFromJSON(json)` (L/LexicalUtils.ts:2408-2420)
- [ ] **JSON-08** `editor.toJSON()` → `{editorState}` (L/LexicalEditor.ts:1716-1720)
- [ ] **JSON-09** Text JSON property order: detail, format, mode, style, text, type, version (super spread last) (TX:699-712)

---

#### 4. NodeState (`L/LexicalNodeState.ts`)
- [ ] **NS-01** `createState(key, {parse, unparse?, isEqual?, resetOnCopyNode?})` → StateConfig; `defaultValue = parse(undefined)`; unparse defaults identity; isEqual defaults `Object.is` (NS:~140-175)
- [ ] **NS-02** `parse` must accept any unknown JSON (including undefined) and return a valid value (NS StateValueConfig)
- [ ] **NS-03** `$getState(node, cfg, 'latest'|'direct')`: latest uses getLatest; no state → default (NS $getState)
- [ ] **NS-04** Unknown (unparsed) JSON keys are lazily parsed on first `getValue` and promoted to known (NS getValue)
- [ ] **NS-05** `$setState(node, cfg, valueOrUpdater)`: updater gets prev; equal (isEqual) → return latest without getWritable; direct value always writes (even if equal) (NS $setState)
- [ ] **NS-06** Dev: two different StateConfigs with same key on one node → invariant (collision) (NS $checkCollision)
- [ ] **NS-07** `$getStateChange(node, prevNode, cfg)` → null if isEqual else `[value, prevValue]` (direct reads) (NS $getStateChange)
- [ ] **NS-08** toJSON: start from unknown state; known values equal to default are omitted, others unparsed; flat keys hoisted to top level; remaining non-empty object under `"$"` (NODE_STATE_KEY) (NS toJSON; L/LexicalConstants.ts:153)
- [ ] **NS-09** Flat state: `$config({stateConfigs:[{stateConfig, flat:true}]})` → serialized as top-level JSON prop; on import flat keys read from top level and merged into parse state (NS createSharedNodeState, $updateStateFromJSON)
- [ ] **NS-10** SharedNodeState per registered node type: `sharedConfigMap` (key→config, built from stateConfigs up the class chain, plus lazily any config used) and `flatKeys` (NS createSharedNodeState; L/LexicalEditor.ts:885)
- [ ] **NS-11** `updateFromJSON(record)` resets all known values to default, clears unknown, then applies record (known keys parsed, others stored unknown) (NS NodeState.updateFromJSON)
- [ ] **NS-12** `$updateStateFromJSON` only creates state if node already has state or JSON has state (NS $updateStateFromJSON)
- [ ] **NS-13** State copy-on-write: `getWritable(node)` new NodeState if owner differs, re-parsing known unknown keys and pruning (NS getWritable, parseAndPruneNextUnknownState)
- [ ] **NS-14** `resetOnCopyNode` configs reset to default on `$copyNode` (not on same-key clone) (NS resetOnCopyNode; L/LexicalNode.ts:623-627)
- [ ] **NS-15** `nodeStatesAreEquivalent(a,b)`: identical → true; compare known values (missing side uses default, `!==` then isEqual) and unknown values by `!==` across both sides; feeds text merge (NRM-05) (NS nodeStatesAreEquivalent)
- [ ] **NS-16** Two text nodes differing only in a state value that equals default on one side vs absent on the other are equivalent (default fallback)
- [ ] **NS-17** `$cloneNodeState(from, to)` used by splitText so split parts share state values (NS $cloneNodeState; TX:1043,1066)
- [ ] **NS-18** `size` tracks number of distinct known+unknown keys (dev-asserted) (NS NodeState ctor/computeSize)
- [ ] **NS-19** `__state` is a non-enumerable property on nodes (L/LexicalNode.ts:637)

---

#### 5. `$config` / static node config
- [ ] **CFG-01** `$config()` instance method on prototype returns `{[type]: StaticNodeConfigValue}`; must not depend on constructor state (L/LexicalNode.ts:~535-560)
- [ ] **CFG-02** `this.config(type, cfg)` helper fills `extends` (defaults to prototype parent class) and `type` (L/LexicalNode.ts:~562-571)
- [ ] **CFG-03** Options: `type`, `$transform(node)`, `$importJSON(json)`, `importDOM` (DOMConversionMap), `stateConfigs` (StateConfig | {stateConfig, flat}), `extends` (exact superclass) (L/LexicalNode.ts:102-172)
- [ ] **CFG-04** `getStaticNodeConfig(klass)`: if class has own static getType, use matching record entry; else last entry of record defines type (L/LexicalUtils.ts:2348-2378)
- [ ] **CFG-05** Abstract classes (LexicalNode, ElementNode, DecoratorNode) get no type; a class not subclassing this Lexical build's LexicalNode throws (version mismatch) (L/LexicalUtils.ts:2318-2346)
- [ ] **CFG-06** Auto-fills missing statics: `getType` → type; `clone` → `new klass()` with pending-node-to-clone (constructor must have 0 required args, dev-checked); `importJSON` → `$importJSON` or `new klass().updateFromJSON(json)`; `importDOM` → config importDOM (L/LexicalUtils.ts:2379-2430)
- [ ] **CFG-07** Called at createEditor for every node for side effects (L/LexicalEditor.ts:822-823)
- [ ] **CFG-08** Transform collection follows `ownNodeConfig.extends` chain when present, else JS prototype chain (L/LexicalEditor.ts:713-745)
- [ ] **CFG-09** `buildImportMap({tag: fn})` identity helper typing DOM conversions by tag name (L/LexicalNode.ts:365-369)
- [ ] **CFG-10** DOMConversion `{conversion, priority 0-4}`; output `{node: null|node|node[], after?, forChild?}` (L/LexicalNode.ts:371-395)
- [ ] **CFG-11** Dev warnings: missing static getType/clone, exportDOM without importDOM, missing importJSON (L/LexicalEditor.ts:843-876)

---

#### 6. Caret API (`L/caret/LexicalCaret.ts`, `L/caret/LexicalCaretUtils.ts`) — MODEL
- [ ] **CARET-01** Directions 'next'|'previous'; flip is involution (Caret:22-30, 580)
- [ ] **CARET-02** SiblingCaret(origin, dir): points at origin's next/previous sibling; `getParentAtCaret` = origin.parent (Caret:175-226, 593-652, 765-791)
- [ ] **CARET-03** ChildCaret(element, dir): points at first child ('next') / last child ('previous'); parent = origin (Caret:228-279, 482-578)
- [ ] **CARET-04** TextPointCaret(text, dir, offset): sibling caret carrying text offset; 'next' covers text after offset, 'previous' before (Caret:281-331, 654-821)
- [ ] **CARET-05** Offset arg can be number or 'next'(=size)/'previous'(=0); invalid offset dev-throws, prod clamps (Caret:902-933)
- [ ] **CARET-06** Iterating a caret yields successive SiblingCarets in its direction (Caret:391-397)
- [ ] **CARET-07** `getNodeAtCaret`, `getAdjacentCaret` (sibling caret of node at caret), `getSiblingCaret`, `getChildCaret` (element origin only), `getParentCaret(rootMode)` (null at root, or at shadow root with 'shadowRoot') (Caret:399-404, 502-520, 607-623, 674-684)
- [ ] **CARET-08** `insert(node)`: sibling next=insertAfter, previous=insertBefore; child next=splice(0,0), previous=append (Caret:69-73, 545-563, 773-819)
- [ ] **CARET-09** `remove()` removes node at caret; `replaceOrInsert(node, includeChildren)` no-op if node is origin or target (Caret:405-422)
- [ ] **CARET-10** `splice(deleteCount, nodes, nodesDirection)`: precompute removals, replace targets in order, insert remainder, remove leftovers (Caret:423-479)
- [ ] **CARET-11** `getFlipped()`: sibling next of X ↔ sibling previous of X's next sibling, or ChildCaret of parent at edge; ChildCaret ↔ sibling caret of edge child or flipped ChildCaret if empty; TextPointCaret just flips direction (Caret:197-210, 508-514, 624-630, 686-692)
- [ ] **CARET-12** `isSameNodeCaret` (same origin key & direction; text/sibling interchangeable) vs `isSamePointCaret` (also same type & text offset) (Caret:521-536, 631-652, 693-712)
- [ ] **CARET-13** `getLatest()` refreshes origin; carets do not track mutations (Caret:490-500, 601-606, 668-673)
- [ ] **CARET-14** CaretRange(anchor, focus, direction) must share direction (Caret:1157-1167)
- [ ] **CARET-15** `range.iterNodeCarets(rootMode)`: pre-order between anchor and focus excluding text slices; element yielded as ChildCaret on enter and SiblingCaret on leave (Caret:1027-1044)
- [ ] **CARET-16** `range.getTextSlices()`: 0–2 slices; same text node at both ends → single slice in anchor slot with distance focus-anchor (Caret:1003-1025)
- [ ] **CARET-17** TextPointCaretSlice: signed `distance`; `getSliceIndices`, `getTextContent`, `getTextContentSize=|distance|`, `removeTextSlice()` (no special token/segmented handling, keeps empty node) (Caret:333-370, 1050-1092)
- [ ] **CARET-18** `isCollapsed` = anchor.isSamePointCaret(focus) (Caret:1000-1002)
- [ ] **CARET-19** `$extendCaretToRange(anchor)` = range to root's sibling caret (end of document in direction) (Caret:1128-1135)
- [ ] **CARET-20** `$getCollapsedCaretRange(c)` = (c,c) (Caret:1137-1142)
- [ ] **CARET-21** `$comparePointCaretNext(a,b)` document order of 'next' carets: same origin → text offsets / text before sibling / child before sibling; ancestor/descendant by caret type; branch by sibling scan (Caret:1230-1293)
- [ ] **CARET-22** `$getCommonAncestor(a,b)` → 'same'|'ancestor'|'descendant'|'branch'{a,b children of common} or null (Caret:1368-1423)
- [ ] **CARET-23** `$getAdjacentChildCaret(c)` = child caret of adjacent node if element else its sibling caret (descend-first step) (Caret:977-981)
- [ ] **CARET-24** `$getChildCaretOrSelf` (Caret:964-975)
- [ ] **CARET-25** `$caretFromPoint(point, dir)`: text → TextPointCaret; element → `$getChildCaretAtIndex` (Utils:61-89)
- [ ] **CARET-26** `$getChildCaretAtIndex(parent, i, dir)`: 'next' caret i steps from ChildCaret (clamped at end) then flipped for 'previous' (Utils:577-596)
- [ ] **CARET-27** `$setPointFromCaret`: text caret → text point; sibling of text → text point at end in direction; sibling of non-text → parent element point index+1 ('next') or index ('previous'); child caret → (origin, 0) or (origin, size) (Utils:91-125)
- [ ] **CARET-28** `$caretRangeFromSelection` → range with direction 'next' if anchor ≤ focus else 'previous'; `$updateRangeSelectionFromCaretRange`, `$setSelectionFromCaretRange` (reuses current Range or new) (Utils:127-170)
- [ ] **CARET-29** `$rewindSiblingCaret`: caret pointing at origin from its other side (previous sibling's caret, or parent's ChildCaret) (Utils:183-197)
- [ ] **CARET-30** `$removeTextFromCaretRange(range, sliceMode)`: no-op if collapsed; process in 'next' order; remove fully-covered nodes (elements only if their start was entered); slices: fully covered (removeEmptySlices) or token with non-zero distance → remove node; else remove text, segmented → replaced by plain text node (format/style kept); `preserveEmptyTextSliceCaret` keeps first empty slice node (Utils:232-344)
- [ ] **CARET-31** After removal, deepest attached anchor/focus candidates (self then rewound parents) found; blocks merged: focus block (only if its start was entered and is a block below common ancestor, not crossing shadow root) children appended to anchor block, focus block and now-empty ancestors removed (`remove(true)`); returns collapsed range at best attached candidate in original direction; throws if none attached (Utils:346-436)
- [ ] **CARET-32** `$normalizeCaret`: descend to deepest ChildCaret; text origin → TextPointCaret at edge; adjacent text sibling → TextPointCaret on it at near edge (Utils:482-505)
- [ ] **CARET-33** `$isExtendableTextPointCaret`: text caret not already at its directional edge (Utils:507-524)
- [ ] **CARET-34** `$getCaretInDirection`, `$getCaretRangeInDirection` (flipping a range swaps anchor/focus) (Utils:526-575)
- [ ] **CARET-35** `$getAdjacentSiblingOrParentSiblingCaret(c, rootMode)` → next caret climbing parents + depth delta (Utils:603-636)
- [ ] **CARET-36** `$getAdjacentNodes(c)` all following siblings (Utils:638-650)
- [ ] **CARET-37** `$splitTextPointCaret`: at edge → sibling caret/rewound; else splitText and return caret after first part (Utils:652-669)
- [ ] **CARET-38** `$splitAtPointCaretNext(caret, {$copyElementNode=$copyNode, $splitTextPointCaretNext, rootMode='shadowRoot', $shouldSplit, removeEmptyDestination})`: splits parent at caret moving following siblings into a copied element inserted after parent; ChildCaret at start: empty+removeEmpty → remove; non-canBeEmpty or !shouldSplit('first') → caret before parent; returns parent's sibling caret (Utils:671-739)
- [ ] **CARET-39** `makeStepwiseIterator({initial, hasNext, step, map})` (Caret:1186-1206)

---

#### 7. Selection model (`L/LexicalSelection.ts`)

##### 7.1 Points & selections
- [ ] **SEL-01** Point {key, offset, type 'text'|'element'}; `set(key, offset, type, onlyIfChanged?)` moves composition key with it, clears selection caches, marks dirty (not in read-only) (Sel:138-227)
- [ ] **SEL-02** Dev: point type must match node kind (text point on TextNode, element point on ElementNode) (Sel:206-215)
- [ ] **SEL-03** `Point.isBefore`: same key → offset compare; else normalized carets compared in document order (Sel:167-174)
- [ ] **SEL-04** RangeSelection {anchor, focus, format, style, dirty, cached nodes/isBackward}; `is()` compares points + format + style (Sel:476-533)
- [ ] **SEL-05** `isCollapsed` anchor.is(focus); `isBackward` focus before anchor (cached outside read-only) (Sel:535-537, 1989-1999)
- [ ] **SEL-06** `getNodes()` via caret range in 'next' order with legacy quirks (`$getNodesFromCaretRangeCompat`); collapsed must yield ≤1 node; cached outside read-only (Sel:550-581, 3478-3570)
- [ ] **SEL-07** `getTextContent()`: blocks separated by "\n" (empty block counts); partial text sliced; decorators/linebreaks included unless collapsed last (Sel:599-665)
- [ ] **SEL-08** `toggleFormat`, `setFormat`, `setStyle`, `hasFormat` on selection (marks dirty) (Sel:720-761)
- [ ] **SEL-09** NodeSelection: set of keys; add/delete/clear mark dirty; never collapsed/backward; `getStartEndPoints` null; `insertText`/`insertRawText` no-op; `insertNodes` inserts after last selected node then removes selected nodes; `deleteNodes` moves selection after first node (when it is current/previous selection) then removes all (Sel:330-470)
- [ ] **SEL-10** `$createRangeSelection` (root,0 element ×2), `$createNodeSelection`, `$getSelection` (pending), `$getPreviousSelection` (committed), `$setSelection` (marks dirty, clears cache; dev error on frozen) (Sel:2661-2669, 2841-2849; L/LexicalUtils.ts:658-674)

##### 7.2 insertText (Sel:772-1174)
- [ ] **SEL-11** Element start point → creates TextNode (selection format/style) at that position (in new Paragraph if parent is root; spliced into Paragraph child at index 0) (Sel:281-310, 790-797)
- [ ] **SEL-12** Collapsed at end of token/segmented, or `!canInsertTextAfter`, or parent can't insert after and node last → use next text sibling if insertable else create new text (format/style) after node (or after parent); recurse (Sel:823-851)
- [ ] **SEL-13** Collapsed at start mirror (prev sibling; new node gets format but NOT style — **AMBIGUOUS** asymmetry) (Sel:852-872)
- [ ] **SEL-14** Inside segmented (not at end) → replaced by plain text node (selection format) (Sel:873-877)
- [ ] **SEL-15** Non-collapsed across non-insertable parents → insertText('') then normalize boundaries then insert (Sel:878-893)
- [ ] **SEL-16** Single node: token/tab → replaced by new text node; collapsed with format/style mismatch → empty node adopts format else new text node inserted (split at offset); else spliceText; empty result → remove node; selection format/style synced to node; composing adjusts anchor offset back (Sel:895-952)
- [ ] **SEL-17** Multi-node: trims last node (spliceText / remove), moves remaining children of last block after first node, removes emptied ancestors and selected nodes not kept, splices first node (Sel:953-1173)

##### 7.3 Other RangeSelection ops
- [ ] **SEL-18** `insertRawText(text)` = insertNodes of `$generateNodesFromRawText` (\n,\r\n→LineBreak, \t→Tab, rest Text) (Sel:763-765, 3317-3347)
- [ ] **SEL-19** `removeText()` = `$removeTextFromCaretRange` then update points; re-sets as current if replaced (Sel:1176-1183)
- [ ] **SEL-20** `formatText(type, alignWith=null)`: collapsed → toggle selection format + clear composition; no text nodes → toggle + apply to selected elements' textFormat; else compute next format from first text node, split at boundaries (token/segmented not split, whole node formatted), middle nodes aligned to last's format, update points, selection.format = first|last (Sel:1193-1336)
- [ ] **SEL-21** formatText starting at end of first text node skips it (Sel:1236-1243)
- [ ] **SEL-22** Element textFormat set to `getFormatFlags(type, firstNextFormat)` for selected elements (Sel:1209-1216, 1253-1257)
- [ ] **SEL-23** `insertNodes(nodes)`: empty → no-op; non-collapsed → removeText; anchor on root → insertParagraph then recurse (Sel:1344-1359)
- [ ] **SEL-24** insertNodes into a block with `__language` (CodeNode duck-typing): if first node also code → insertText(textContent) else splice inline at split (Sel:1365-1373) — **AMBIGUOUS** duck-typed special case
- [ ] **SEL-25** insertNodes all-inline → split inline ancestors at point, splice into block, select end of last (Sel:1378-1389)
- [ ] **SEL-26** insertNodes with blocks: wrap inline runs into `createParentElementNode()` blocks (LineBreak starts an empty block and is dropped); insert paragraph split if target block non-empty; merge first block's children into target if mergeable (non-empty block & target non-empty or canMergeWhenEmpty); insert rest after; merge trailing split paragraph into last inserted block if canMergeWhenEmpty or last is block; remove empty target; select end of last descendant; drop trailing LineBreak in target (Sel:1391-1457, 3432-3476)
- [ ] **SEL-27** `insertParagraph()`: anchor on root → new paragraph at offset; else split to block, `block.insertNewAfter(selection,false)`, move following children into it, selectStart; null if block can't split (Sel:1463-1488)
- [ ] **SEL-28** `insertLineBreak(selectStart?)`: insertNodes([LineBreak]); selectStart → caret before the break (Sel:1494-1502)
- [ ] **SEL-29** `extract()`: splits boundary text nodes, returns nodes, updates points (Sel:1511-1564)
- [ ] **SEL-30** `applyDOMRange(range)` resolve DOM points (BRIDGE) + normalize (Sel:667-701)
- [ ] **SEL-31** `setTextNodeRange(a, ao, f, fo)` (Sel:583-597)
- [ ] **SEL-32** `$getCharacterOffsets`: element point → 0 or full text length if at end; same collapsed element → [0,0] (Sel:2010-2039)
- [ ] **SEL-33** `$insertNodes(nodes)` global: current or previous selection, else root.selectEnd() (Sel:3284-3291)
- [ ] **SEL-34** `$getTextContent()` selection text or '' (Sel:3349-3355)
- [ ] **SEL-35** `$updateElementSelectionOnCreateDeleteNode(sel, parent, index, times)`: shifts element-point offsets on parent when children inserted/removed at ≤/< offset, then resolves to text children (Sel:2851-2970)
- [ ] **SEL-36** `moveSelectionPointToSibling`: prefer end of previous sibling (text/element), else start of next, else parent index (Sel:2997-3036)

##### 7.4 modify / delete
- [ ] **SEL-40** `deleteCharacter(isBackward)` collapsed, nothing in deletion direction (all text slices zero distance up to doc edge): walk carets — inline descend; shadow root boundary → stop (remove empty anchor block first); next block sibling → merge target; isolated decorator → nothing; decorator adjacent to empty anchor block (keyboard-selectable or block) → remove block, NodeSelection on decorator; otherwise remove decorator; merge-block: empty adjacent same-parent block removed (keeps current block type), else removeText across boundary (Sel:1754-1883)
- [ ] **SEL-41** `forwardDeletion` guard: forward delete at end of node whose next sibling (or parent's) is a shadow root (table) → no-op (Sel:1722-1745)
- [ ] **SEL-42** Otherwise `modify('extend', isBackward, 'character')`; segmented node at focus/anchor → `$removeSegment`; else unicode fixup (SEL-44) then removeText; collapsed+backward+offset 0 → `$collapseAtStart` chain (Sel:1886-1925)
- [ ] **SEL-43** After non-collapsed backward delete leaving empty first root child at element offset 0 → collapseAtStart on it (Sel:1926-1942)
- [ ] **SEL-44** Unicode: if extended span >1 code unit in same text node and contains no surrogate pair and no `\p{Emoji}` → shrink to delete exactly one code unit (combining marks deleted individually; emoji/astral graphemes deleted whole) (Sel:2151-2232)
- [ ] **SEL-45** `$removeSegment`: split on `/(?=\s)/`, drop the segment at offset, join+trim; empty → remove node else set text and caret at segment start (Sel:2234-2272)
- [ ] **SEL-46** `deleteWord`: forwardDeletion guard; extend by 'word'; still collapsed → deleteCharacter; else removeText (Sel:1965-1987)
- [ ] **SEL-47** `deleteLine`: extend by 'lineboundary'; still collapsed → deleteCharacter; else removeText (Sel:1945-1963)
- [ ] **SEL-48** `modify(alter, isBackward, granularity)` first tries `$modifySelectionAroundDecoratorsAndBlocks` (pure model): move+character on non-collapsed → collapse to the side in direction; adjacent non-isolated decorator → move to it (move+character on keyboard-selectable → NodeSelection); 'decorators-and-blocks' mode crosses into adjacent block (ChildCaret) or block decorator (Sel:1578-1588, 3572-3658)
- [ ] **SEL-49** Otherwise `modify` uses DOM `Selection.modify()` and reads back the range (VIEW); extend clamps to current shadow root; swaps points if DOM anchor≠range start; lineboundary then re-applies decorator mode (Sel:1589-1714)
- [ ] **SEL-50** **AMBIGUOUS/IMPORTANT** Headless (no DOM selection): `modify` returns without change, so `deleteCharacter` mid-text, `deleteWord`, `deleteLine` fall through to collapsed `removeText` = no-op (except collapseAtStart at offset 0 and the decorator/block paths); word/line/character granularity needs a model-side segmenter in a Rust port (Sel:1592-1596)
- [ ] **SEL-51** `resolveSelectionPointOnBoundary` / `$normalizeSelectionPointsForBoundaries`: text points at node edges snap into adjacent text/inline element siblings depending on direction & collapsed (Sel:2486-2566)
- [ ] **SEL-52** `$isSelectionCapturedInDecorator(domNode)` = nearest Lexical node is a decorator; `isSelectionCapturedInDecoratorInput` = that plus activeElement is INPUT/TEXTAREA/foreign contenteditable (L/LexicalUtils.ts:162-181) — BRIDGE
- [ ] **SEL-53** Selection creation per event: DOM selection used for selectionchange/beforeinput/composition*/triple-click/drop/no event; otherwise previous Range cloned; format/style kept if anchor key unchanged else from anchor node (text: node format/style, element: textFormat/textStyle) (Sel:2697-2798)
- [ ] **SEL-54** Selection transforms (`TextNode.selectionTransform`) run each update after fn (Sel:2972-2995; L/LexicalUpdates.ts:1019)
- [ ] **SEL-55** Composition key: `$setCompositionKey` marks old/new nodes writable; read-only `$getCompositionKey` returns null (L/LexicalUtils.ts:512-539)

### 3B — Behaviour inventory B: markdown, link, hashtag, text, overflow, offset, mark, tailwind, file, React model plugins

Source: Lexical v0.45.0, `target/lexical-upstream/packages`. Paths are relative to `packages/`.
Abbreviations: `MT` = `lexical-markdown/src/MarkdownTransformers.ts`, `MI` = `MarkdownImport.ts`,
`ME` = `MarkdownExport.ts`, `MS` = `MarkdownShortcuts.ts`, `ITF` = `importTextFormatTransformer.ts`,
`ITT` = `importTextTransformers.ts`, `ITM` = `importTextMatchTransformer.ts`, `MU` = `lexical-markdown/src/utils.ts`,
`LN` = `lexical-link/src/LexicalLinkNode.ts`, `LE` = `LexicalLinkExtension.ts`, `AL` = `LexicalAutoLinkExtension.ts`,
`CL` = `ClickableLinkExtension.ts`.

**Macro patch:** [markdown patch](../../../apps/web/patches/%40lexical%252Fmarkdown%400.45.0.patch) (Macro repo) changes only
`LIST_INDENT_SIZE` from 4 to 2, in `MT` and in the legacy `MU` copy. The Rust port must make this a
parameter, default 2 for Macro, with 4 for upstream parity tests.

---

#### 1. @lexical/markdown

##### 1.1 Transformer types

- [ ] **MD-T-01** Four transformer kinds: `element`, `multiline-element`, `text-format`, `text-match`. `Transformer` is their union (MT:55-59).
- [ ] **MD-T-02** ElementTransformer = `{dependencies, export(node, traverseChildren, selection?) -> string|null, regExp, replace(parentNode, children, match, isImport) -> bool|void, type:'element', triggerOnEnter?}`. If `replace` returns `false`, the next transformer is tried (MT:61-97).
- [ ] **MD-T-03** MultilineElementTransformer = `{handleImportAfterStartMatch?({lines, rootNode, startLineIndex, startMatch, transformer}) -> [bool, lastLineIndex]|null|undefined, dependencies, export?, regExpStart, regExpEnd?: RegExp | {optional?: true, regExp}, replace(rootNode, children|null, startMatch, endMatch|null, linesInBetween|null, isImport) -> bool|void}` (MT:99-168).
- [ ] **MD-T-04** TextFormatTransformer = `{format: TextFormatType[], tag, intraword?, type:'text-format'}` (MT:170-175).
- [ ] **MD-T-05** TextMatchTransformer = `{dependencies, export?(node, exportChildren, exportFormat), importRegExp?, regExp, replace?(textNode, match) -> void|TextNode, getEndIndex?(node, match) -> number|false, trigger?, type:'text-match'}`. When `replace` returns a TextNode, import recurses into that node (MT:177-219).
- [ ] **MD-T-06** `transformersByType` groups the transformers by `type` and keeps their input order inside each group (MU:429-444). `indexBy` skips items whose key is falsy (MU:406-427).

##### 1.2 Shared regexes and node state

- [ ] **MD-RX-01** `ORDERED_LIST_REGEX = /^(\s*)(\d{1,})\.\s/` (MT:221).
- [ ] **MD-RX-02** `UNORDERED_LIST_REGEX = /^(\s*)[-*+]\s/` (MT:222).
- [ ] **MD-RX-03** `CHECK_LIST_REGEX = /^(\s*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s/i`. The bullet is optional, the box may be empty (`[]`), and the match is case-insensitive (MT:223).
- [ ] **MD-RX-04** `HEADING_REGEX = /^(#{1,6})\s/` (MT:224). `QUOTE_REGEX = /^>\s/` (MT:225).
- [ ] **MD-RX-05** `CODE_START_REGEX = /^([ \t]*`{3,})([\w-]+)?[ \t]?/`. `CODE_END_REGEX = /^[ \t]*`{3,}$/` (MT:226-227).
- [ ] **MD-RX-06** `CODE_SINGLE_LINE_REGEX = /^[ \t]*```[^`]+(?:(?:`{1,2}|`{4,})[^`]+)*```(?:[^`]|$)/` (MT:228-229).
- [ ] **MD-RX-07** `TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/` and `TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-*:? ?)+\|\s?$/`. Used only by normalizeMarkdown (MT:230-231).
- [ ] **MD-RX-08** `TAG_START_REGEX = /^<[a-z_][\w-]*(?:\s[^<>]*)?\/?>/i`, `TAG_END_REGEX = /^<\/[a-z_][\w-]*\s*>/i`. `ENDS_WITH(r)` wraps a regex as `(?:src)$` and keeps its flags (MT:232-235).
- [ ] **MD-ST-01** NodeState `mdListMarker` (on ListNode): parses to a string matching `^[-*+]$`, else `'-'`. `resetOnCopyNode` (MT:237-240).
- [ ] **MD-ST-02** NodeState `mdCodeFence` (on CodeNode): parses to a string matching `^`{3,}$`, else `'```'`. `resetOnCopyNode` (MT:242-250).
- [ ] **MD-ST-03** NodeState `mdHardLineBreak` (on LineBreakNode): parses to `\` or 2+ spaces (`/^(\\| {2,})$/`), else `''`. `resetOnCopyNode` (MT:254-262).
- [ ] **MD-ST-04** `parseMarkdownHardLineBreak(line)`: a trailing `\` returns `[line minus \, '\\']`. Otherwise `/^(.*?\S)( {2,})$/` returns `[text, spaces]`. Otherwise `null` (MT:264-273).
- [ ] **MD-ST-05** `$createMarkdownLineBreakNode(prev)`: creates a LineBreakNode. If the last child of `prev` is a text node ending in a hard-break marker, the marker is stripped from that text and stored in `mdHardLineBreak`. A last text child that is only 2+ spaces counts too, when earlier content on the same line (since the last LineBreak) contains non-whitespace; that text is set to `''` (MT:275-332).
- [ ] **MD-PUNCT-01** `PUNCTUATION_OR_SPACE = /[!-/:-@[-`{-~\s]/`, `WHITESPACE = /\s/`, ``PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/`` (MU:446-448). These are ASCII only. **AMBIGUOUS**: CommonMark treats Unicode punctuation and whitespace as flanking characters; this code does not. Rust `\s` must match JS `\s`, which includes the Unicode Zs class and U+FEFF.
- [ ] **MD-EMPTY-01** `isEmptyParagraph(node)`: true when the node is a ParagraphNode with no children, or with exactly one TextNode whose text matches `/^\s{0,3}$/` (MU:450-464).
- [ ] **MD-ESC-01** `unescapeText(v)`: removes the backslash from `\X` for any ASCII punctuation X in `[!-/:-@[-`{-~]`, then decodes decimal `&#N;` entities through `String.fromCodePoint`. Hex `&#xNN;` and named entities are not decoded (MU:466-472).
- [ ] **MD-LEGACY-01** `MU:30-404` (MarkdownCriteria, `getAllMarkdownCriteriaFor*`, legacy `listExport`/`processNestedLists`) is dead code: nothing outside `utils.ts` references it. Do not port it.

##### 1.3 Built-in transformers

- [ ] **MD-HEADING-01** HEADING: element, deps `[HeadingNode]`, `regExp` HEADING_REGEX. `replace` uses createBlockNode with `h{len(#)}`. `triggerOnEnter: true` (MT:478-494).
- [ ] **MD-HEADING-02** HEADING export: `'#'.repeat(level) + ' ' + children`. Non-heading nodes return null (MT:480-486).
- [ ] **MD-BLOCK-01** createBlockNode replace: creates the node, appends the children, replaces the parent with it, and calls `node.select(0,0)` when not importing (MT:334-345).
- [ ] **MD-QUOTE-01** QUOTE: element, deps `[QuoteNode]`, regExp QUOTE_REGEX, `triggerOnEnter: true` (MT:496-533).
- [ ] **MD-QUOTE-02** QUOTE import: when the previous sibling is a QuoteNode, a markdown linebreak plus the children are spliced into the end of that quote and the paragraph is removed. Consecutive `> ` lines therefore merge into one quote joined by LineBreaks. Outside import, a new QuoteNode always replaces the paragraph and is selected at (0,0) (MT:511-530).
- [ ] **MD-QUOTE-03** QUOTE export: the exported children are split on `\n` and each line is prefixed with `'> '` (MT:498-509).
- [ ] **MD-QUOTE-04** Nested quotes (`> > x`) are not supported: the inner `> ` stays literal text after the first prefix is stripped. **AMBIGUOUS** (no code handles it).
- [ ] **MD-LIST-01** UNORDERED_LIST: element, deps `[ListNode, ListItemNode]`, regExp UNORDERED_LIST_REGEX, `listReplace('bullet')`, `triggerOnEnter`. Shares export `$listExport(node, children, 0, selection)` (MT:694-705).
- [ ] **MD-LIST-02** ORDERED_LIST: same shape with ORDERED_LIST_REGEX and `listReplace('number')` (MT:720-731).
- [ ] **MD-LIST-03** CHECK_LIST: same shape with CHECK_LIST_REGEX and `listReplace('check')` (MT:707-718).
- [ ] **MD-LIST-04** listReplace: creates a ListItemNode. For a check list, `checked = (match[3] === 'x')`, otherwise undefined (MT:372-374). **AMBIGUOUS/bug**: the regex is case-insensitive, so `[X]` matches but imports as unchecked.
- [ ] **MD-LIST-05** listReplace list marker: for bullet or check lists, takes the first non-space character of `match[0]`. If it is one of `-*+`, it is stored in `mdListMarker` on the target list. For a check list without a bullet (`[ ] x`), the first character is `[`, so no marker is set and export uses the default `-` (MT:375-380).
- [ ] **MD-LIST-06** listReplace placement: (a) if the next sibling is a ListNode of the same type, the item is inserted before its first child and the paragraph removed; (b) else if the previous sibling is a same-type list, the item is appended to it; (c) else a new ListNode is created, with `start = Number(match[2])` for number lists, and replaces the paragraph. The marker state is updated on the list in all three cases (MT:381-412).
- [ ] **MD-LIST-07** listReplace then appends the children to the item, selects it at (0,0) when not importing, and calls `setIndent(getIndent(match[1]))` when the indent is non-zero (MT:413-420).
- [ ] **MD-LIST-08** getIndent(ws) = (number of tabs) + floor((number of spaces) / LIST_INDENT_SIZE). Spaces and tabs are counted anywhere in the prefix and are not position-aware. LIST_INDENT_SIZE is 4 upstream and 2 under the Macro patch (MT:347-366).
- [ ] **MD-LIST-09** $listExport: walks the list's children. A ListItem whose only child is a ListNode is a nested wrapper and exports recursively at `depth+1`; it does not consume an index. Items with no selected child are skipped when a selection is given. Indent is `' '.repeat(depth*LIST_INDENT_SIZE)` (MT:424-457).
- [ ] **MD-LIST-10** $listExport prefixes: number lists `${start+index}. `; check lists `${marker} [x|' '] `; bullet lists `marker + ' '`. Lines are joined with `\n` (MT:458-475).
- [ ] **MD-LIST-11** $listExport escaping: for non-number lists, child text matching `/^(\s{0,3}\d+)(\.\s)/` gets a backslash before the `.`, so `1. ` text inside a bullet does not re-import as an ordered list (MT:466-469).
- [ ] **MD-LIST-12** Ordered numbering always counts from `listNode.getStart()`. Per-item `value` is ignored on export (MT:461-462).
- [ ] **MD-CODE-01** CODE: multiline-element, deps `[CodeNode]`, regExpStart CODE_START_REGEX, `regExpEnd {optional:true, regExp: CODE_END_REGEX}` (MT:535-692).
- [ ] **MD-CODE-02** CODE export: `fence + (language||'') + (text ? '\n'+text : '') + '\n' + fence`, with fence taken from `mdCodeFence` (default ```` ``` ````). If the code text contains the fence, the fence becomes the longest run of 3+ backticks in the text plus one (MT:537-558).
- [ ] **MD-CODE-03** CODE import (handleImportAfterStartMatch): `fence = startMatch[1]`, `fenceLength = fence.trim().length`. If the text after the fence (which includes the language word) ends with `` `{fenceLength,}$ ``, the block is single-line: content is the text before that closing run, no language is set (`startMatch[2]` forced to `''`), and the call returns `[true, startLineIndex]` (MT:560-590). Example: ```` ```js foo``` ```` gives code text `js foo` with no language.
- [ ] **MD-CODE-04** CODE multiline import: scans the following lines for `^[ \t]*`{fenceLength,}$`. A closing fence must be at least as long as the opening one; extra backticks are allowed. Lines in between are the content. Any text after the full start match (after the language and one optional space or tab) on the opening line is unshifted as the first content line. Returns `[true, closeLineIndex]` (MT:592-615).
- [ ] **MD-CODE-05** An unclosed fence consumes all remaining lines into the code block and returns `[true, lines.length-1]` (MT:617-624).
- [ ] **MD-CODE-06** CODE.replace (import, children null): stores `fence = startMatch[1].trim()` (or ```` ``` ````) in mdCodeFence and sets language from `startMatch[2]`, `[\w-]+` only, so `c++` gives language `c` and `++` becomes leading content (MT:644-645). **AMBIGUOUS**.
- [ ] **MD-CODE-07** CODE.replace content rules: single line with an end match: kept verbatim. Single line without an end match: one leading space stripped. Multiple lines: a whitespace-only first line is dropped, otherwise one leading space is stripped from it; trailing empty (length 0) lines are popped; lines are joined with `\n`. The result goes into one TextNode inside the CodeNode, appended to the root (MT:647-683).
- [ ] **MD-CODE-08** CODE.replace (shortcut, children given): createBlockNode with `$createCodeNode(match[2])`, which carries the language from the fence (MT:684-688).
- [ ] **MD-CODE-09** Fence indentation is not removed from content lines (no CommonMark indent stripping). **AMBIGUOUS**.
- [ ] **MD-FMT-01** INLINE_CODE `{format:['code'], tag:'`'}` (MT:733-737).
- [ ] **MD-FMT-02** HIGHLIGHT `{format:['highlight'], tag:'=='}` (MT:739-743).
- [ ] **MD-FMT-03** BOLD_ITALIC_STAR `{format:['bold','italic'], tag:'***'}` (MT:745-749).
- [ ] **MD-FMT-04** BOLD_ITALIC_UNDERSCORE `{format:['bold','italic'], intraword:false, tag:'___'}` (MT:751-756).
- [ ] **MD-FMT-05** BOLD_STAR `{format:['bold'], tag:'**'}` (MT:758-762).
- [ ] **MD-FMT-06** BOLD_UNDERSCORE `{format:['bold'], intraword:false, tag:'__'}` (MT:764-769).
- [ ] **MD-FMT-07** STRIKETHROUGH `{format:['strikethrough'], tag:'~~'}` (MT:771-775).
- [ ] **MD-FMT-08** ITALIC_STAR `{format:['italic'], tag:'*'}` (MT:777-781).
- [ ] **MD-FMT-09** ITALIC_UNDERSCORE `{format:['italic'], intraword:false, tag:'_'}` (MT:783-788).
- [ ] **MD-FMT-10** There is no built-in transformer for underline, subscript, superscript, or other text formats. They are dropped on export.
- [ ] **MD-LINK-01** LINK: text-match, deps `[LinkNode]`, `trigger: ')'` (MT:794-851).
- [ ] **MD-LINK-02** LINK `importRegExp = /(?:\[(.+?)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))/`. Unanchored, lazy text, the URL has no whitespace or parentheses, optional `"title"` (MT:813-814).
- [ ] **MD-LINK-03** LINK shortcut `regExp = /(?:\[([^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))$/`. Anchored at the caret (`$`) and allows one level of balanced `[]` inside the text (MT:815-816).
- [ ] **MD-LINK-04** LINK replace: does nothing when the text node already has a LinkNode ancestor. Otherwise it unescapes the URL and title (MD-ESC-01) and creates `$createLinkNode(url, {title})` with no `rel` (MT:817-827).
- [ ] **MD-LINK-05** LINK replace bracket balance: more `]` than `[` in the link text aborts. More `[` than `]`: the text is split at `[`; `'[' + first part` becomes a plain text node before the link and the rest becomes the link text (MT:828-846).
- [ ] **MD-LINK-06** LINK replace: the link text node copies the source text node's format and is returned so import keeps transforming inside it (MT:839-848).
- [ ] **MD-LINK-07** LINK export: skips non-LinkNodes and AutoLinkNodes, which export as their plain children. Output is `[children](url)`, or `[children](url "title")` with `\` and `"` in the title backslash-escaped. The URL is not escaped (MT:796-812).

##### 1.4 Transformer arrays (order matters)

- [ ] **MD-ARR-01** `ELEMENT_TRANSFORMERS = [HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST]` (MT:853-858). CHECK_LIST is exported but not included.
- [ ] **MD-ARR-02** `MULTILINE_ELEMENT_TRANSFORMERS = [CODE]` (MT:860-861).
- [ ] **MD-ARR-03** `TEXT_FORMAT_TRANSFORMERS = [INLINE_CODE, BOLD_ITALIC_STAR, BOLD_ITALIC_UNDERSCORE, BOLD_STAR, BOLD_UNDERSCORE, HIGHLIGHT, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH]` (MT:867-877).
- [ ] **MD-ARR-04** `TEXT_MATCH_TRANSFORMERS = [LINK]` (MT:879).
- [ ] **MD-ARR-05** `TRANSFORMERS = [...ELEMENT, ...MULTILINE, ...TEXT_FORMAT, ...TEXT_MATCH]`, the default for import, export, and shortcuts (MT:881-886, index.ts:59,78,93; MS:441).
- [ ] **MD-ARR-06** If CHECK_LIST is appended after UNORDERED_LIST, `- [ ] x` matches UNORDERED_LIST first on import and becomes a bullet item with text `[ ] x`. Callers must put CHECK_LIST before UNORDERED_LIST. **AMBIGUOUS**: upstream gives no ordering guidance.
- [ ] **MD-ARR-07** React `DEFAULT_TRANSFORMERS = [HR, ...TRANSFORMERS]`. HR is an element transformer: deps `[HorizontalRuleNode]`, `regExp /^(---|\*\*\*|___)\s?$/`, export `'***'`, `triggerOnEnter`. On import, or when the paragraph has a next sibling, HR replaces the paragraph; otherwise it is inserted before it. Then `line.selectNext()` (lexical-react/src/LexicalMarkdownShortcutPlugin.tsx:21-42).

##### 1.5 Import engine

- [ ] **MD-IMP-01** `$convertFromMarkdownString(md, transformers=TRANSFORMERS, node?, shouldPreserveNewLines=false, shouldMergeAdjacentLines=false)`. When `!shouldPreserveNewLines` the input first goes through `normalizeMarkdown(md, shouldMergeAdjacentLines)`; with preserve it is used raw (index.ts:57-72).
- [ ] **MD-IMP-02** Import clears the target (`node` or root) with `root.clear()`, then processes the input line by line, split on `\n` only. `\r` is not stripped (MI:54-58). **AMBIGUOUS** for CRLF input.
- [ ] **MD-IMP-03** Per line, multiline transformers run first. If one imports, the loop jumps to its returned last line index. Otherwise `$importBlocks` runs on the line (MI:60-87).
- [ ] **MD-IMP-04** Multiline generic path (when there is no `handleImportAfterStartMatch`, or it returned `undefined`): the end regex is searched from the start line onward. A same-line end match at the same index as the start match is ignored. With an optional end, reaching the last line counts as the end. Lines in between strip the start match from the first line and the end match from the last. If `replace` returns `false`, the remaining transformers for this line are skipped (break) and the line falls through to `$importBlocks`. A `null` result from `handleImportAfterStartMatch` moves on to the next transformer (MI:120-230).
- [ ] **MD-IMP-05** $importBlocks: creates a paragraph with one TextNode holding the line and appends it to root. Element transformers are tried in order: on a regex match the text becomes the line after `match[0]`, and if `replace(...)` does not return `false` the loop stops (MI:232-254). **AMBIGUOUS**: when `replace` returns false, the text node keeps the stripped text.
- [ ] **MD-IMP-06** $importBlocks then runs the text transformers on that text node (MI:256-260).
- [ ] **MD-IMP-07** Line merging: when `!shouldPreserveNewLines`, the paragraph is still attached (no element transformer applied), the line is non-empty, and the previous sibling is a Paragraph, Quote, or List, the paragraph's children are appended to the target with a markdown LineBreak (MD-ST-05) and the paragraph is removed. For a List, the target is the ListItem holding its last descendant. No merge happens when the target's text size is 0 (MI:262-292).
- [ ] **MD-IMP-08** Post-pass: when `!shouldPreserveNewLines`, every top-level child that is an empty paragraph (MD-EMPTY-01) is removed, as long as root has more than one child at that moment (MI:89-101).
- [ ] **MD-IMP-09** Post-pass: in every top-level element's text nodes, each `\t` is split out and replaced with a TabNode, including tabs inside code blocks (MI:102-107, 295-315).
- [ ] **MD-IMP-10** After import, if a selection exists, `root.selectStart()` (MI:110-112).
- [ ] **MD-IMP-11** normalizeMarkdown is line-based. A line matching CODE_SINGLE_LINE_REGEX is kept without toggling the code state. A line matching CODE_START or CODE_END toggles the in-code state and is trimEnd'ed. Lines inside code are kept raw (MT:888-922). **AMBIGUOUS**: any line matching CODE_START, including a longer fence with a language, toggles state regardless of fence length, unlike the importer, which requires a matching close length.
- [ ] **MD-IMP-12** normalizeMarkdown outside code: the line is pushed separately (not merged) when any of these hold: it is empty; the previous line is empty or absent; the previous line is a heading; the line is a heading, quote, list, check, table row, table divider, or HTML start/end tag; the previous line has a hard break; the previous line ends with an HTML tag or is a code end; or `!shouldMergeAdjacentLines`. Otherwise it is appended to the previous line with one space: `last + ' ' + line.trimStart()`, or the raw line if it carries a hard-break marker (MT:924-958).
- [ ] **MD-IMP-13** normalizeMarkdown whitespace: when not merging, the pushed line keeps trailing whitespace (rawLine), except that whitespace-only lines collapse to `''`. When merging, lines are trimEnd'ed unless they carry a hard-break marker. The last input line never counts as having a hard break (MT:900-901, 950-954).
- [ ] **MD-IMP-14** With the default `shouldMergeAdjacentLines=false`, adjacent non-empty lines are still joined in one paragraph by a LineBreakNode (MD-IMP-07); with true they are joined by a space (soft wrap). Under `shouldPreserveNewLines`, normalization and merging are skipped: every line becomes its own paragraph and empty paragraphs are kept.
- [ ] **MD-IMP-15** Text transformer driver (importTextTransformers): finds the outermost text-format match (F) and the outermost text-match match (M). If both exist, F wins when it encloses M (`F.start <= M.start && F.end >= M.end`) or when M starts after F ends; otherwise M wins. The winner is applied, then the driver recurses into nodeAfter, nodeBefore, and transformedNode, in that order, skipping code-formatted nodes (ITT:41-135).
- [ ] **MD-IMP-16** After its transforms, the driver sets the original `textNode` (the first split segment) to `unescapeText` of its own content (ITT:137-140).
- [ ] **MD-IMP-17** `canContainTransformableMarkdown(n)`: n is a TextNode without the `code` format (ITT:29-33).
- [ ] **MD-IMP-18** **AMBIGUOUS/quirk**: a code span starting at index 0 reuses the original text node (MD-IMP-16), so its content gets unescaped (`` `a\*b` `` gives `a*b`). A code span in mid-text is a different node and stays raw.
- [ ] **MD-IMP-19** Text-match outermost choice: for each transformer that has both `replace` and `importRegExp`, the first regex match is taken; `endIndex` comes from `getEndIndex` (a `false` result skips the transformer) or from `start+len`. A later candidate replaces the current one only if it starts strictly earlier and either wraps it or ends at or before its start (ITM:12-76).
- [ ] **MD-IMP-20** Text-match apply: split the node at [start,end] (only at end when start is 0) and call `replace(transformedNode, match)`. Its returned TextNode becomes the recursion target; nodeBefore and nodeAfter are always returned (ITM:78-110).
- [ ] **MD-IMP-21** Text-format index: per tag, `transformersByTag[tag]`. `openTagsRegExp` alternates the escaped tags (escaping `* ^ +`) in input order with the `g` flag (MI:317-363). `fullMatchRegExpByTag` is built (MI:330-350) but only the backtick entry is used by the importer. The others are kept for API compatibility.
- [ ] **MD-IMP-22** Code-span regex: ``(^|[^\\`])(`)((?:\\`|[^`])+?)(`)(?!`)``. Group 1 is the preceding character, so real start = `index + len(g1)`. Content is group 3. Only single-backtick spans are recognized. **AMBIGUOUS**: CommonMark multi-backtick spans (``` `` a`b `` ```) are not.
- [ ] **MD-IMP-23** findOutermostTextFormatTransformer: every code-span match becomes an exclusion range, and the first one is the code candidate. Emphasis delimiters are scanned outside the exclusions. If both exist, emphasis wins only when it encloses the code span; otherwise the code span wins. The returned synthetic match is `[full, tag, content]` with `index` set (ITF:25-123).
- [ ] **MD-IMP-24** scanDelimiters: delimiter characters are the first characters of all non-backtick tags (`* _ = ~` by default). A character is skipped when it is escaped (an odd number of preceding backslashes) or inside an excluded range. A run of the same character is one delimiter `{index, char, length, originalLength, canOpen, canClose, active}`, kept only if it can open or close (ITF:125-184).
- [ ] **MD-IMP-25** isFlanking(left): primary = the character after the run (left) or before it (right); secondary = the other side. Not flanking when primary is absent or whitespace. Flanking when primary is not punctuation. When primary is punctuation, flanking only when secondary is absent, whitespace, or punctuation (ITF:316-340). This is the CommonMark left/right-flanking rule.
- [ ] **MD-IMP-26** canEmphasis: must be flanking on its own side. `*` is then always allowed. `_` is allowed when it is not also flanking on the opposite side, or when the adjacent outer character (before an opener, after a closer) is punctuation (CommonMark rule for intraword underscore). Other characters (`=`, `~`) only need flanking (ITF:293-314).
- [ ] **MD-IMP-27** The `intraword:false` transformer flag is not consulted by import, only by shortcuts (MS:248-254, 316-322). Import intraword behaviour comes only from MD-IMP-26, and only for `_`.
- [ ] **MD-IMP-28** processEmphasis: iterates closers left to right. `openersBottom` is keyed by `char + canOpen`. Each closer searches backwards for an active opener with the same character that can open (ITF:186-291).
- [ ] **MD-IMP-29** Rule of 3: if the opener can close or the closer can open, skip the pair when `(o.orig + c.orig) % 3 == 0` and neither original length is a multiple of 3 (ITF:224-234).
- [ ] **MD-IMP-30** Tag selection: the longest registered tag starting with that character whose length is at most `min(opener.length, closer.length)`. With no such tag the pair is skipped. A lone `~` or `=` never matches the default tags (ITF:236-243).
- [ ] **MD-IMP-31** Match span: `start = opener.index + (opener.length - matchLen)`, `end = closer.index + matchLen`, `content = text[opener.index+opener.length .. closer.index]`, using the opener's remaining length. The result kept is the earliest start, ties broken by the larger end (outermost) (ITF:245-261).
- [ ] **MD-IMP-32** After a pairing, delimiters between the pair are deactivated, both lengths shrink by matchLen, the opener stays active if it has length left, and the closer's index advances when it has leftover length; otherwise the closer is deactivated and the scan moves on (ITF:263-278).
- [ ] **MD-IMP-33** No opener found: `openersBottom[key] = pos-1`; a closer that cannot open is deactivated (ITF:281-287).
- [ ] **MD-IMP-34** Only one (outermost) emphasis match is returned per pass; nesting comes from recursing into the transformed node. Example: `***a***` gives `***` (bold and italic) in one step; `**a*` gives `*` + italic(`a`) with a literal leading `*`.
- [ ] **MD-IMP-35** importTextFormatTransformer: if `match[0]` equals the whole text the node is reused; otherwise it is split. Text becomes `match[2]` and each format in `transformer.format` is turned on if missing (ITF:342-389).
- [ ] **MD-IMP-36** Backslash escapes: an escaped delimiter is not a delimiter (MD-IMP-24). Escape removal (MD-ESC-01) runs per text node after its transforms.
- [ ] **MD-IMP-37** Each element transformer runs once per line; nested block syntax inside a list item or quote (`- # x`, `> - x`) stays literal text. **AMBIGUOUS**.
- [ ] **MD-IMP-38** Numbered list import keeps only the first item's number as `start`; later numbers are ignored (MD-LIST-06).

##### 1.6 Export engine

- [ ] **MD-EXP-01** `$convertToMarkdownString(transformers=TRANSFORMERS, node?, shouldPreserveNewLines=false)` exports the children of `node` or of root (index.ts:77-87).
- [ ] **MD-EXP-02** Element transformers for export are `[...multiline, ...element]`; the first non-null export wins (ME:46, 344-369).
- [ ] **MD-EXP-03** Text-format transformers for export keep only single-format ones (no `***` or `___`), stable-sorted with code-containing ones last. Default order: BOLD_STAR, BOLD_UNDERSCORE, HIGHLIGHT, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH, INLINE_CODE (ME:51-60).
- [ ] **MD-EXP-04** Top-level fallback: an element with no matching transformer exports its children concatenated; a decorator exports `getTextContent()`; anything else is null and skipped (ME:371-385).
- [ ] **MD-EXP-05** Top-level join: each non-null result is pushed. When `!shouldPreserveNewLines`, `i>0`, and neither the child nor the previous child is an empty paragraph, the result is prefixed with `\n`. Results are joined with `\n`. Blocks are separated by a blank line and each empty paragraph adds one newline (ME:62-91).
- [ ] **MD-EXP-06** $exportChildren: for each child, text-match exports are tried first (inner exportChildren passes `unclosableTags = [...unclosable, ...unclosed]` so outer formats cannot close inside a link). Then LineBreak exports `mdHardLineBreak + '\n'`; Text goes through exportTextFormat; Element recurses; Decorator gives `getTextContent()` (ME:387-479).
- [ ] **MD-EXP-07** exportTextFormat escaping: for non-code text, `* _ ` ~ \` get backslash-escaped. With `shouldPreserveNewLines`, backslash itself is not escaped. Code text is never escaped (ME:496-502).
- [ ] **MD-EXP-08** Characters not escaped on export: `[ ] # > - + = | < & !` and digits. `==text==`, a leading `# `, `- `, `> `, or `[a](b)` in plain text therefore re-imports as formatting (lossy round trip). **AMBIGUOUS**.
- [ ] **MD-EXP-09** Whitespace hoisting: the output is split into leading whitespace, core, and trailing whitespace (`/^(\s*)(.*?)(\s*)$/s`). The result is `closingTagsBefore + leading + openingTags + core + closingTagsAfter + trailing`, so tags hug non-whitespace (ME:504-596). The comment about `&#32;` escaping is stale: the code hoists whitespace and does not encode it.
- [ ] **MD-EXP-10** Opening tags: for each transformer in export order, when the node has the format (checkHasFormat: a non-code format on whitespace-only text counts as absent) and the format is not yet applied, the tag is opened if the previous text sibling lacks the format or the tag is not already in unclosedTags. It is pushed to unclosedTags (ME:523-541).
- [ ] **MD-EXP-11** Closing tags: find the first index i in unclosedTags whose format is not carried by both this node and the next text sibling (`hasFormat`, whitespace counts). Pop tags from the end down to i in reverse order, skipping (keeping) unclosable tags. A popped tag goes into `closingTagsBefore` when this node lacks the format, else into `closingTagsAfter`. Only the first such i is processed (break) (ME:543-581).
- [ ] **MD-EXP-12** Whitespace-only non-code node: returns `closingTagsBefore + escapedText`, with no opening tags and closingTagsAfter dropped (ME:582-586). **AMBIGUOUS/bug**: tags popped into closingTagsAfter for such a node are lost, which can leave markers unclosed.
- [ ] **MD-EXP-13** Siblings considered by format continuity are only adjacent TextNodes; a LineBreak or inline element breaks continuity (ME:599-607).
- [ ] **MD-EXP-14** Combined formats: bold+italic gives `***x***` (opening order `**` then `*`, closing reversed). Bold+code gives `**`x`**` (code innermost).
- [ ] **MD-EXP-15** Formatted text spanning a link: `**a [b](u) c**`. Tags open outside are unclosable inside the link (MD-EXP-06); a tag that must close before a later node is emitted as closingTagsBefore (ME:568-573).
- [ ] **MD-EXP-16** `$convertSelectionToMarkdownString(transformers, selection, shouldPreserveNewLines)` returns `''` for a null selection or a collapsed range (index.ts:92-105).
- [ ] **MD-EXP-17** Selection export: top-level nodes are included when selected or when a descendant is. Element transformers get the selection (lists skip unselected items). Text nodes export only the selected slice (`$sliceSelectedTextNodeContent(..., 'clone')`). Inline elements with selected children are included via `extractWithChild(child, selection, 'html')` (ME:100-342).
- [ ] **MD-EXP-18** Export never emits CHECK_LIST unless CHECK_LIST (or another list transformer, since all three share `$listExport`) is in the array. With the default TRANSFORMERS, check lists still export as `- [ ] ` because UNORDERED_LIST's export handles every ListNode type (MT:696-699).

##### 1.7 Markdown shortcuts (registerMarkdownShortcuts)

- [ ] **MD-SC-01** At registration, each element, text-match, and multiline transformer's dependency classes are checked with `editor.hasNode`; a missing one throws an invariant (MS:470-488).
- [ ] **MD-SC-02** An update listener ignores updates tagged COLLABORATION or HISTORIC, and updates while `editor.isComposing()` (MS:541-551).
- [ ] **MD-SC-03** The listener requires both the previous and the current selection to be RangeSelections, the current one collapsed, and different from the previous one, except on a COMPOSITION_END-tagged update (MS:558-572).
- [ ] **MD-SC-04** The anchor must be a TextNode in `dirtyLeaves`. Outside composition end, `anchorOffset == 1` or `anchorOffset <= prevAnchorOffset + 1`, so only single-character typing triggers (MS:574-587).
- [ ] **MD-SC-05** On composition end, the character before the caret must be in the trigger set: space, the last character of every text-format tag, and every text-match `trigger` (MS:455-468, 589-596).
- [ ] **MD-SC-06** The transform runs in `editor.update`. It is skipped when the anchor has the code format or the parent is null or a CodeNode (MS:598-607).
- [ ] **MD-SC-07** Transform order is element, multiline, text-match, text-format; the first that applies wins. On success the update is tagged HISTORY_PUSH, so the shortcut is its own undo step (MS:490-538, 609-611).
- [ ] **MD-SC-08** Element shortcut: the parent's parent must be root or a shadow root, and the anchor must be the parent's first child. When not triggered by Enter, the character before the caret must be `' '` (a space only, no other whitespace) (MS:42-70).
- [ ] **MD-SC-09** Element shortcut match: `match[0]` must be exactly `anchorOffset` long (or `anchorOffset-1` when it does not end with a space and this is not Enter). The anchor is split at the caret, `replace(parent, [remainder, ...nextSiblings], match, false)` is called, and the leading prefix node is removed. Text after the caret is kept (MS:72-93).
- [ ] **MD-SC-10** Multiline shortcut: same preconditions. Only transformers whose `regExpEnd` is absent or optional take part. Uses `regExpStart` with the same length rule, then calls `replace(parent, siblings, match, null, null, false)` (MS:96-160). Typing ```` ``` ```` plus space (or ```` ```lang ```` plus space) creates a CodeNode with that language.
- [ ] **MD-SC-11** Text-match shortcut: the character before the caret must be a registered `trigger`. The text is cut at the caret and matched with `regExp`, which is end-anchored. The matched range is split out, `replaceNode.selectNext(0,0)` places the caret after it, then `replace(node, match)` runs. The first matching transformer wins (MS:162-207).
- [ ] **MD-SC-12** Text-format shortcut: candidates are the transformers indexed by the last character of their tag, the character before the caret, in input order: `*` gives [***, **, *], `_` gives [___, __, _], plus `` ` ``, `=`, `~` (MS:209-224, 447-450).
- [ ] **MD-SC-13** Text-format checks in order: a multi-character tag must end exactly at the caret; the character before the closing tag must not be a space; with `intraword:false`, the character after the caret, if any, must match `/[!-/:-@[-`{-~\s]/` (MS:226-254).
- [ ] **MD-SC-14** Open-tag search: backwards in the same node from `closeTagStart`, the first position where the tag matches and the character after it is not `' '`. If not found, previous siblings are searched (whole text), stopping at a LineBreak, skipping code-formatted text, and passing over non-text nodes (MS:256-293, 402-421).
- [ ] **MD-SC-15** Text-format rejections: empty content in the same node; a character before the open tag equal to closeChar (so `**` does not count as a `*` opener); with `intraword:false`, a character before the open tag that is not punctuation or space; for non-code formats, an open position inside an unclosed code span (an odd number of backticks before it in the open node) (MS:295-330, 389-400).
- [ ] **MD-SC-16** Text-format apply: closing then opening tag characters are removed, a range is selected from open to close, each missing format is applied (`formatText`), the range collapses to the focus, formats are toggled off the collapsed selection, and the new selection's `format` is reset to the previous selection's format (MS:332-379). **AMBIGUOUS**: the reset overrides the toggles, so the caret keeps its pre-shortcut format.
- [ ] **MD-SC-17** KEY_ENTER (LOW priority): ignored with Shift. Requires a collapsed range, a TextNode anchor that is not code-formatted, a parent that is not a CodeNode, and the caret at the end of the text node. Tries multiline, then element transformers with `triggerOnEnter`, using expected match length = anchorOffset and no trailing-space requirement. On success it calls preventDefault and returns true, without a HISTORY_PUSH tag (MS:615-675).
- [ ] **MD-SC-18** Enter fires only when the whole first text node equals the prefix (for example ```` ``` ```` or `---`). Built-in HEADING, QUOTE, and LIST regexes need trailing whitespace, so `# ` plus Enter converts and `# Title` plus Enter does not (MS:72-80).
- [ ] **MD-SC-19** There is no shortcut for CHECK_LIST unless it is passed in; `[ ] ` or `- [ ] ` typed with UNORDERED_LIST first becomes a bullet at `- `.

---

#### 2. @lexical/link

##### 2.1 LinkNode

- [ ] **LNK-N-01** LinkNode is an ElementNode with type `'link'` and fields `__url` (default `''`), `__target`, `__rel`, `__title` (each `string|null`, default null) (LN:80-121).
- [ ] **LNK-N-02** JSON: `{...element, rel, target, title, url}`. importJSON maps falsy rel, target, or title to null (LN:171-206).
- [ ] **LNK-N-03** Getters and setters for url, target, rel, title; each setter takes a writable copy and returns it (LN:208-246).
- [ ] **LNK-N-04** `isInline() = true`, `canBeEmpty() = false`, `canInsertTextBefore() = false`, `canInsertTextAfter() = false`. Typing at the link's edges goes outside the link (LN:257-271).
- [ ] **LNK-N-05** `insertNewAfter` inserts a `$copyNode(this)` (fresh key, same attributes) after the link (LN:248-255).
- [ ] **LNK-N-06** `extractWithChild`: true only for a RangeSelection whose anchor and focus are both inside the link and whose text is non-empty (LN:273-290).
- [ ] **LNK-N-07** `isEmailURI` checks the `mailto:` prefix; `isWebSiteURI` checks `https://` or `http://` (LN:292-300).
- [ ] **LNK-N-08** `shouldMergeAdjacentLink(other)`: same type, and identical url, target, rel, and title (LN:302-310).
- [ ] **LNK-N-09** `sanitizeUrl(url)`: the URL is passed through formatUrl and parsed. A protocol outside {http:, https:, mailto:, sms:, tel:} gives `about:blank`. A parse failure returns the formatted URL. Used only for DOM href and click; the model keeps the raw URL (LN:71-77, 184-196).
- [ ] **LNK-N-10** `formatUrl(url)`: a scheme `/^[a-z][a-z0-9+.-]*:/i` is kept as is; `/`, `#`, or `.` prefixes are kept; a URL containing `@` gets `mailto:`; one matching `/^\+?[0-9\s()-]{5,}$/` gets `tel:`; anything else gets `https://` (LN:932-964).
- [ ] **LNK-N-11** `$createLinkNode(url='', attrs?)` applies node replacement. `$isLinkNode` uses instanceof, so it includes AutoLinkNode (LN:448-464).
- [ ] **LNK-N-12** HTML import of `<a>` produces a link only when the anchor has text or element children, taking href (or `''`), rel, target, and title (LN:427-440). The extension path (LinkImportExtension.ts:21-44) skips empty anchors and uses `$distributeInlineWrapper` so block descendants are lifted out with the link wrapping each inline run.

##### 2.2 $linkNodeTransform (registered by registerLink)

- [ ] **LNK-TR-01** Block children inside a link are lifted out: for each non-inline element child, its children move into a copied link inside that block, and the block moves to the nearest root at that caret without splitting (LN:351-366).
- [ ] **LNK-TR-02** Adjacent merge: when the previous sibling is a mergeable link, this link's children are appended to it and this link removed. Otherwise, when the next sibling is mergeable, its children are absorbed and it is removed. AutoLinkNodes never merge (LN:386-412, 514-516).
- [ ] **LNK-TR-03** When the transform changed something and the link is now empty, the link is removed, and so is its parent if that is now empty (LN:413-422).
- [ ] **LNK-TR-04** Selection is preserved through caret pairs (next and flipped) and fixed up when a boundary caret pointed at the absorbing link; the selection is normalized afterwards (LN:313-349, 369-384, 424).

##### 2.3 AutoLinkNode

- [ ] **LNK-A-01** AutoLinkNode extends LinkNode with type `'autolink'` and `__isUnlinked` (default false). JSON adds `isUnlinked` (LN:475-584).
- [ ] **LNK-A-02** HTML `importDOM` returns null, so autolinks never come from HTML. An unlinked autolink renders as a `<span>` (LN:528-562).
- [ ] **LNK-A-03** `insertNewAfter` creates an AutoLinkNode with the same url, isUnlinked, rel, target, and title (LN:571-583).

##### 2.4 $toggleLink and TOGGLE_LINK_COMMAND

- [ ] **LNK-TG-01** TOGGLE_LINK_COMMAND payload is `string | {url, target?, rel?, title?} | null` (LN:611-613).
- [ ] **LNK-TG-02** `$toggleLink(urlOrAttrs, attributes={})`: with an object first argument, `url = obj.url` and `attributes = {...rest, ...attributes}`, so the second argument wins. When `rel` is undefined it defaults to `'noreferrer'`; an explicit null is kept (LN:740-753).
- [ ] **LNK-TG-03** Selection that is null or neither Range nor Node: no-op (LN:754-761).
- [ ] **LNK-TG-04** NodeSelection with url null: for each node, its nearest non-auto LinkNode ancestor gets the node inserted before it and is removed if empty (LN:763-783).
- [ ] **LNK-TG-05** NodeSelection with url set: an existing non-auto link ancestor gets setURL, setTarget (if defined), and setRel. The title is not updated on this path. Otherwise the node is wrapped in `$createLinkNode(url, {rel, target})` with no title (LN:784-806). **AMBIGUOUS** (title dropped).
- [ ] **LNK-TG-06** Collapsed range with url null: for the first selected node only, its nearest non-auto LinkNode is unwrapped (children spliced into its place) and removed (LN:809-828).
- [ ] **LNK-TG-07** Otherwise the selection is extracted. With url null, each distinct non-auto parent link is split by `$splitLinkAtSelection(link, extracted)` (LN:831-855).
- [ ] **LNK-TG-08** $splitLinkAtSelection: a child counts as extracted when it is an extracted node or an element containing one. If all children are extracted, the link is unwrapped. Extracted children at the start move before the link; at the end, after it. In the middle, they move after the link and the trailing children go into a new copied link after them (LN:681-732).
- [ ] **LNK-TG-09** url set with exactly one extracted node that has any LinkNode ancestor, including an AutoLinkNode: that link is updated (url, plus target, rel, and title when defined) (LN:856-882). **AMBIGUOUS**: this can set the URL on an AutoLinkNode.
- [ ] **LNK-TG-10** url set, general case, wrapped in `$withSelectedNodes` (which restores element-point selection around the original boundary nodes). For each attached node: a LinkNode ancestor (any) gets updated; non-inline elements are skipped; an inline non-auto LinkNode not in the current link's parent block is updated and reused as the current link; other LinkNodes (autolinks, or a second link in the block) are unwrapped. A node whose previous sibling is the current link is appended to it. Otherwise a new `$createLinkNode(url, {rel, target, title})` is created after the node and the node moved into it (LN:884-930, 635-673).
- [ ] **LNK-TG-11** `toggleLink` is a deprecated alias of `$toggleLink` (index.ts:43).

##### 2.5 registerLink and LinkExtension

- [ ] **LNK-R-01** registerLink registers `$linkNodeTransform` on LinkNode (LE:61).
- [ ] **LNK-R-02** TOGGLE_LINK_COMMAND at EDITOR priority: null calls `$toggleLink(null)` and returns true. A string checks `validateUrl` (when set) and on failure returns false; otherwise it calls `$toggleLink(url, config.attributes)`. An object calls `$toggleLink(url, {...config.attributes, rel, target, title})` without validation (LE:62-88).
- [ ] **LNK-R-03** **AMBIGUOUS/quirk**: the object payload spreads `rel: undefined` over config attributes, which then defaults to `'noreferrer'`. Config `attributes.rel` is ignored for object payloads that omit `rel` (LE:77-83).
- [ ] **LNK-R-04** Paste-to-link (registered only when `validateUrl` is set): PASTE_COMMAND at LOW priority. Requires a non-collapsed range, a ClipboardEvent with `clipboardData` whose `text` passes `validateUrl`, and no ElementNode among `selection.getNodes()`. It dispatches TOGGLE_LINK_COMMAND `{...attributes, url: text}`, calls preventDefault, and returns true (LE:89-126).
- [ ] **LNK-R-05** LinkExtension: name `@lexical/link/Link`, nodes `[LinkNode]`, config `{validateUrl: undefined, attributes: undefined}`. mergeConfig shallow-merges the config and also shallow-merges `attributes` (LE:136-156).
- [ ] **LNK-R-06** React LinkPlugin: `{validateUrl?, attributes?}`, throws if LinkNode is not registered, calls registerLink (lexical-react/src/LexicalLinkPlugin.ts:19-32).

##### 2.6 AutoLink

- [ ] **LNK-AL-01** `LinkMatcher = (text) -> {index, length, text, url, attributes?} | null`. `createLinkMatcherWithRegExp(re, urlTransformer = identity)` runs `re.exec(text)` and maps `match[0]` (AL:41-67). **AMBIGUOUS**: a regex with the `g` flag carries `lastIndex` across calls.
- [ ] **LNK-AL-02** findFirstMatch returns the first matcher (in array order) that returns non-null, not the leftmost match overall (AL:69-82).
- [ ] **LNK-AL-03** Default `separatorRegex = /[.,;\s]/`. Boundary checks test one character (AL:84-102).
- [ ] **LNK-AL-04** Content-around validity: inside the text, the character before the match must be a separator; at the node start, the previous sibling (or its last descendant if it is an element) must be null, a LineBreak, or text ending in a separator. The same rule applies after the match with the next sibling's first descendant (AL:119-168).
- [ ] **LNK-AL-05** There is no punctuation trimming in the extension; trailing punctuation is decided by the matcher regex (for example the playground URL_REGEX ends on `[a-zA-Z0-9@_~#?&//=]`). **AMBIGUOUS**: Macro must provide its own matchers.
- [ ] **LNK-AL-06** Text node transform (registerAutoLink): with an AutoLinkNode parent, run handleLinkEdit. Otherwise, when the parent is not a LinkNode and no `excludeParents` predicate matches the direct parent: for simple text that starts with a separator or whose previous sibling is not an AutoLinkNode, collect the nodes to match and run $handleLinkCreation. handleBadNeighbors always runs (AL:561-586).
- [ ] **LNK-AL-07** Nodes to match: the node itself plus following simple-text siblings, stopping after the first one containing whitespace (AL:507-523).
- [ ] **LNK-AL-08** $handleLinkCreation returns early when any node's parent is an active (not unlinked) autolink. It loops `findFirstMatch` over the remaining text and validates boundaries against the full initial text with an accumulated offset. A valid match not already linked is wrapped; an invalid one advances the offset. Each created link calls `onChange(url, null)` (AL:293-367).
- [ ] **LNK-AL-09** Link creation over one node: split out [start,end], create a fresh TextNode with `match.text` copying format, detail, and style, put it in an AutoLinkNode with the match url and attributes, and replace the segment. Over several nodes: the first segment is copied into a new text node and later segments are moved in, with the last split at end. When the caret was in the first node, the selection is restored on the new text node (AL:214-291).
- [ ] **LNK-AL-10** handleLinkEdit: when any child is not simple text, or the text does not fully equal the first match's text, or either neighbor fails the boundary rule, the link is unwrapped and `onChange(null, oldUrl)` is called. Otherwise the URL is updated when it changed (`onChange(new, old)`), and rel and target are synced from `match.attributes` (onChange is called with those values) (AL:369-425). It also runs on unlinked autolinks.
- [ ] **LNK-AL-11** handleBadNeighbors (skipped when the node is inside an active autolink). When the previous sibling is an active autolink still adjacent: text not starting with a separator unwraps the link. Otherwise, when the text starts with a TLD continuation (email `^\.[a-zA-Z]{2,}`, else `^\.[a-zA-Z0-9]{1,}`) and the combined text fully matches, the node is appended into the link and the link re-validated. When the next sibling is an active autolink still adjacent and the text does not end with a separator, that link is unwrapped (AL:427-493).
- [ ] **LNK-AL-12** Unwrap (replaceWithChildren) moves the children after the link in order and removes the link (AL:495-505).
- [ ] **LNK-AL-13** TOGGLE_LINK_COMMAND with a null payload on a range, at LOW priority (ahead of the Link handler): extracts the selection, flips `isUnlinked` and marks dirty every AutoLinkNode parent of an extracted node, then returns false so LinkExtension also runs (AL:587-608).
- [ ] **LNK-AL-14** AutoLinkConfig `{changeHandlers: [], excludeParents: [], matchers: [], separatorRegex}`. mergeConfig concatenates the three arrays instead of replacing them. Name `@lexical/link/AutoLink`, nodes `[AutoLinkNode]`, depends on LinkExtension (AL:525-639).
- [ ] **LNK-AL-15** React AutoLinkPlugin `{matchers, onChange?, excludeParents?}` asserts AutoLinkNode is registered and calls registerAutoLink (lexical-react/src/LexicalAutoLinkPlugin.ts).
- [ ] **LNK-AL-16** Reference matchers from the playground (not in the package): `URL_REGEX = /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*[a-zA-Z0-9@_~#?&//=])?/` (url: kept if it starts with `http`, else `https://` is prefixed). EMAIL_REGEX (url gets `mailto:` prefixed). `excludeParents: [$isCodeNode]` (lexical-playground/src/plugins/AutoLinkExtension/index.ts:13-29).

##### 2.7 ClickableLink

- [ ] **LNK-CL-01** Click and mouseup (button 1) listeners on root. The nearest element ancestor of the clicked node is resolved. When not disabled: a LinkNode gives `sanitizeUrl(url)` and `getTarget()`; otherwise the nearest DOM `<a>` gives href and target (CL:52-82).
- [ ] **LNK-CL-02** A null or empty URL does nothing. A non-collapsed range selection calls preventDefault and returns, so link text can be selected (CL:84-93).
- [ ] **LNK-CL-03** `window.open(url, newTab || middle || meta || ctrl || target==='_blank' ? '_blank' : '_self')`, then preventDefault. `isMiddle` requires `type==='auxclick' && button===1`, but the listener is `mouseup`, so a middle click opens `_self` unless `newTab` is set (CL:95-107). **AMBIGUOUS/bug**.
- [ ] **LNK-CL-04** ClickableLinkExtension config `{disabled:false, newTab:false}`, depends on LinkExtension. React ClickableLinkPlugin defaults `newTab=true` (CL:132-142; lexical-react/src/LexicalClickableLinkPlugin.tsx:14-28).

---

#### 3. Hashtag, text, overflow, offset, mark, tailwind, file

##### 3.1 @lexical/hashtag

- [ ] **HT-01** HashtagNode extends TextNode with type `'hashtag'`, `isTextEntity() = true`, `canInsertTextBefore() = false` (canInsertTextAfter is inherited, true). JSON is the text-node shape with type `hashtag` (lexical-hashtag/src/LexicalHashtagNode.ts:15-61).
- [ ] **HT-02** Regex = `'(' + boundary + ')(' + hash + ')(' + alnum* + alpha + alnum* + ')'` with flag `i`, where `boundary = ^|$|[^&/` + alnum + `]` and `hash = [#＃]` (LexicalHashtagExtension.ts:224-249).
- [ ] **HT-03** The hashtag body must contain at least one alpha character. Digits (several Unicode digit ranges) and `_` are allowed but not alone. Combining marks are allowed after the first character (LexicalHashtagExtension.ts:202-215).
- [ ] **HT-04** Match result: `start = index + len(boundary group)`, `end = start + len(body) + 1`. The hash is included; the leading boundary character is excluded (LexicalHashtagExtension.ts:251-265).
- [ ] **HT-05** The preceding character cannot be `&`, `/`, or alphanumeric, so `a#b`, `&#123`, and `/#x` are not hashtags. Nothing limits the trailing side (the body is greedy).
- [ ] **HT-06** **AMBIGUOUS/quirk**: the CJK Extension C, D, and Compatibility ranges are built with `String.fromCharCode(0x2a700)` etc., which truncates to 16 bits. The class actually contains `꜀-뜿`, `띀-렟`, `-﨟`, BMP ranges that cover Hangul syllables and PUA. Port the effective ranges, not the intended ones (LexicalHashtagExtension.ts:103-112).
- [ ] **HT-07** `เ-๎` is commented as Hangul but is Thai. The ranges are character-set literals; port them verbatim. Unicode letter coverage is the hand-written tables, not `\p{L}` (LexicalHashtagExtension.ts:82-200).
- [ ] **HT-08** registerLexicalHashtag calls registerLexicalTextEntity with `getHashtagMatch` and `$createHashtagNode(text)`. HashtagConfig `{getHashtagMatch}` is overridable. HashtagExtension name `@lexical/hashtag/Hashtag`, nodes `[HashtagNode]` (LexicalHashtagExtension.ts:268-303).

##### 3.2 @lexical/text

- [ ] **TXT-01** registerLexicalTextEntity(editor, getMatch, Klass, createNode) registers two transforms, on TextNode and on Klass, and returns both removers (lexical-text/src/registerLexicalTextEntity.ts:40-220).
- [ ] **TXT-02** Text transform: only on simple text (type `text`, normal mode) (:61-63).
- [ ] **TXT-03** When the previous sibling is the entity class: if `getMatch(prev+text)` is null or the previous node's mode is not normal, the previous node becomes simple text (format kept) and the transform returns. Otherwise `diff = match.end - len(prev)`; if positive, the first `diff` characters move into the entity (prev.select() then setTextContent), the node is removed or trimmed, and the transform returns (:70-98).
- [ ] **TXT-04** When the previous sibling is non-entity text: return if the combined match is null or starts inside the previous text (:99-101). **AMBIGUOUS**: a null combined match also stops matching inside the current node.
- [ ] **TXT-05** Match loop: find a match in the remaining text. At the end of text, check the combined current and next sibling text: no match turns a next-sibling entity into simple text (or marks the next text dirty) and returns; a match not at 0 returns. A match at 0 right after a text entity is skipped by accumulating `prevMatchLengthToSkip`. Otherwise the match is split out and replaced with `createNode(seg)` with its format copied, then the loop continues on the remainder (:104-171).
- [ ] **TXT-06** Reverse transform (entity class): no match, or a match not at 0, turns the node into simple text. Text beyond `match.end` is split off (it re-runs and becomes simple). Adjacent text entities on either side turn both into simple text (:174-208).
- [ ] **TXT-07** `$rootTextContent()` = `$getRoot().getTextContent()` (lexical-text/src/rootTextContent.ts:14-18).
- [ ] **TXT-08** `$isRootTextContentEmpty(isComposing, trim=true)`: false while composing; otherwise whether the root text (trimmed if requested) is `''`. A curry variant is provided (lexical-text/src/isRootTextContentEmpty.ts:16-44).
- [ ] **TXT-09** `$canShowPlaceholder(isComposing)`: requires untrimmed empty root text, at most one root child, that child not a decorator; if it is an element it must be a Paragraph with `__indent === 0` whose children are TextNodes (lexical-text/src/canShowPlaceholder.ts:24-67). **AMBIGUOUS/bug**: the inner loop reads `topBlockChildren[i]` (the outer index) instead of `[s]`, so only the first child is checked, repeatedly.
- [ ] **TXT-10** `$findTextIntersectionFromCharacters(root, n)`: a pre-order walk that counts only TextNode sizes, with no block separators; LineBreaks and decorators count 0. Returns `{node, offset: n - accumulated}` for the first text where `accumulated + size > n`, else null. An offset exactly at the end of the last text returns null (lexical-text/src/findTextIntersectionFromCharacters.ts:18-61). **AMBIGUOUS**.

##### 3.3 @lexical/overflow and the character limit

- [ ] **OVF-01** OverflowNode: an ElementNode with type `'overflow'` and an inline transform that removes it when empty. `insertNewAfter` delegates to the parent's `insertNewAfter`. `excludeFromCopy() = true`. Renders as a `<span>` with `theme.characterLimit` (lexical-overflow/src/index.ts:21-58).
- [ ] **OVF-02** **AMBIGUOUS**: OverflowNode does not override `isInline()` (ElementNode default false), yet it wraps inline text inside paragraphs. Check how core treats it (lexical-overflow/src/index.ts:21-58).
- [ ] **OVF-03** OverflowExtension: name `@lexical/overflow`, nodes `[OverflowNode]` (:73-76).
- [ ] **OVF-04** useCharacterLimit(editor, max, {strlen = UTF-16 length, remainingCharacters}) asserts OverflowNode is registered (lexical-react/src/shared/useCharacterLimit.ts:42-62).
- [ ] **OVF-05** Tracking: root text is kept from the text-content listener. The update listener returns while composing or when nothing is dirty. It reports `remaining = max - strlen(text)`. When text is over the limit, or was over last time, it runs `$wrapOverflowedNodes(findOffset(...))` in an update tagged HISTORY_MERGE (:64-103). The `lastComputedTextLength === null` branch is dead (it starts at 0).
- [ ] **OVF-06** findOffset: iterates graphemes (`Intl.Segmenter`, falling back to code points) and accumulates `strlen(grapheme)` while it stays at or under max. Returns the UTF-16 offset of the cut (:131-171). A grapheme is never split.
- [ ] **OVF-07** $wrapOverflowedNodes(offset): DFS over all nodes, accumulating the text size of leaves that are not inside an overflow. An existing OverflowNode wholly before the offset is unwrapped, with the selection restored to a sibling or the parent if it got detached. One straddling the offset is unwrapped when its first descendant is simple text or fits. A leaf crossing the offset is split (simple text) or wrapped whole, wrapped in a new OverflowNode, the selection restored, and the node merged with a preceding overflow (:173-256).
- [ ] **OVF-08** **AMBIGUOUS**: findOffset counts root `getTextContent()`, which includes the `\n\n` separators between blocks, but $wrapOverflowedNodes accumulates only leaf sizes. The effective limit is looser by 2 characters per block boundary.
- [ ] **OVF-09** `$mergePrevious(overflow)`: when the previous sibling is an OverflowNode, its children are moved to the front of this one, element-type anchor and focus points are remapped, and the previous node is removed (:265-314). **AMBIGUOUS/bug**: `focusNode = anchor.getNode()` should be the focus node.
- [ ] **OVF-10** DELETE_CHARACTER_COMMAND at LOW priority, always handled (returns true) whenever character limit is active. It calls `selection.deleteCharacter(isBackward)`, then removes the anchor's grandparent (the overflow's parent) if now empty, else that grandparent's next sibling if it is an empty element (:104-126). **AMBIGUOUS**: this replaces the rich-text delete for every delete, not only overflow cases.
- [ ] **OVF-11** CharacterLimitPlugin props: `charset 'UTF-16'` (default) or `'UTF-8'` (TextEncoder byte length, falling back to a `%[89AB]` count), `maxLength` (default 5), and a renderer receiving `remainingCharacters` (lexical-react/src/LexicalCharacterLimitPlugin.tsx:17-91).

##### 3.4 @lexical/offset

- [ ] **OFF-01** OffsetNode = `{type: 'element'|'text'|'inline', key, start, end, parent, child, prev, next}`. OffsetView holds `offsetMap: key -> node`, `firstNode`, `blockOffsetSize` (default 1) (lexical-offset/src/index.ts:27-74).
- [ ] **OFF-02** `$createOffsetView(editor, blockOffsetSize=1, editorState?)` uses the given state, else the pending state, else the current one, and builds offsets from root's children through `$createChildrenArray` (core) (:545-572).
- [ ] **OFF-03** Sizes: text = `__text.length`; any other non-element node (LineBreak, decorator, Tab is TextNode so text) = 1. An element starts at the current offset, then its children are laid out; afterwards, when the previous node was not a block or the element is empty, `blockOffsetSize` is added and `prevIsBlock` set. Its end is the offset after that (:421-498).
- [ ] **OFF-04** **AMBIGUOUS**: inline elements such as LinkNode and MarkNode take the element path and add `blockOffsetSize` as if they were blocks.
- [ ] **OFF-05** **AMBIGUOUS/bug**: children receive `parent = null` (`$createOffsetChild(..., null, ...)`), and only the first child's `parent` is then set to the element (:441-472). Parent walks in diff adjustment are therefore incomplete.
- [ ] **OFF-06** `$searchForNodeWithOffset(first, off)`: walks siblings. A node's end is inclusive (+1) for non-element nodes, or when `blockOffsetSize == 0`. If `off < end`, descend into the child if any, else return the node (:357-390).
- [ ] **OFF-07** `createSelectionFromOffsets(start, end, diffView?)`: looks up both nodes (re-adjusting via `$getAdjustedOffsetFromDiff` when a diff view is given). Text gives `(key, off - node.start, 'text')`; a non-collapsed start at the end of a text node moves to the next text sibling at 0. Inline gives the parent key with `offset = (end > node.start ? node.end : node.start)`; element gives `(key, 0, 'element')`. Returns null if anything is missing (:76-188).
- [ ] **OFF-08** **AMBIGUOUS/bug**: on the inline path the element-point offset is set to the absolute character offset (`node.start` or `node.end`) instead of a child index (:161-176).
- [ ] **OFF-09** `getOffsetsFromSelection(sel) -> [start, end]`: a text point gives `node.start + offset`. An element point resolves `getDescendantByIndex(offset)`, then gives `end` if the descendant's index differs from the offset (past the end), else `start`. Unresolved points give -1 (:190-238).
- [ ] **OFF-10** `$getAdjustedOffsetFromDiff`: walks backwards from the node through prev siblings and each ancestor's prev siblings, adding size deltas against the previous view (a new node adds its whole size), then subtracts the sizes of nodes deleted from the previous view, located from the old offset (:241-355). Port it verbatim; behaviour is heuristic.

##### 3.5 @lexical/mark

- [ ] **MRK-01** MarkNode: an ElementNode with type `'mark'` and `__ids: readonly string[]` (default empty). JSON `{...element, ids}`. HTML importDOM returns null (lexical-mark/src/MarkNode.ts:36-75).
- [ ] **MRK-02** `getIDs` returns a copy; `hasID`; `setIDs`; `addID` is a no-op if present, else appends; `deleteID` removes the first occurrence (:109-137).
- [ ] **MRK-03** `isInline=true`, `canBeEmpty=false`, `canInsertTextBefore=false`, `canInsertTextAfter=false`, so typing at mark edges goes outside (:148-162).
- [ ] **MRK-04** `insertNewAfter` inserts a new MarkNode with the same ids after this one (:139-146).
- [ ] **MRK-05** `extractWithChild`: true only for a RangeSelection with destination `'clone'`, both points inside the mark, and `|focus.offset - anchor.offset| === len(mark text)`. Offsets are compared even across different nodes (:164-185). **AMBIGUOUS**.
- [ ] **MRK-06** `excludeFromCopy(dest)`: true for any destination except `'clone'`, so marks are stripped from HTML/copy output (:187-189).
- [ ] **MRK-07** A mark with an empty `ids` list is not removed automatically. **AMBIGUOUS**: callers (comment plugins) use `$unwrapMarkNode` once the ids are empty.
- [ ] **MRK-08** `$unwrapMarkNode(node)`: moves the children out in order to where the mark was, then removes it (lexical-mark/src/index.ts:22-35).
- [ ] **MRK-09** `$wrapSelectionInMarkNode(sel, isBackward, id, createNode?)`: forces a forward copy of the selection and extracts it (splitting text at the boundaries). Text, inline elements, and inline decorators are wrapped. Existing MarkNodes are skipped (descended into, which creates a nested mark). Blocks and non-inline decorators break the run. Adjacent targets with the same parent share one new mark created with `[id]` (or `createNode([id])`) (:37-127).
- [ ] **MRK-10** After wrapping, the caret collapses to the start of the last created mark when `isBackward`, else its end (:128-135).
- [ ] **MRK-11** `$getMarkIDs(textNode, offset)`: walks up from the text node and returns the ids of the first MarkNode ancestor. At the text node level, when `offset === size` and the next sibling is a MarkNode, that sibling's ids are returned. Returns null if none (:138-158).
- [ ] **MRK-12** Overlapping marks are nested MarkNodes; resolving nested marks is `registerNestedElementResolver` in @lexical/utils (lexical-utils/src/index.ts:396), not this package. A mark with more than one id renders with the `markOverlap` theme (MarkNode.ts:77-107).
- [ ] **MRK-13** MarkExtension: name `@lexical/mark`, nodes `[MarkNode]` (index.ts:163-166).

##### 3.6 @lexical/tailwind

- [ ] **TW-01** TailwindExtension (`@lexical/tailwind`) provides only an `EditorThemeClasses` map of Tailwind class strings (heading h1-h3, hr, link, list including the checklist pseudo-elements, paragraph, quote, table, and text formats) and a TreeView peer-config. There is no model behaviour; port it as optional theme data or skip it (lexical-tailwind/src/index.ts:30-190).

##### 3.7 @lexical/file

- [ ] **FILE-01** SerializedDocument JSON envelope = `{editorState: SerializedEditorState, lastSaved: number (epoch ms), source: string (default 'Lexical'), version: string (the package version, '0.45.0')}` (lexical-file/src/fileImportExport.ts:15-24).
- [ ] **FILE-02** `serializedDocumentFromEditorState(state, {source?, lastSaved?})`: `editorState = state.toJSON()`, `lastSaved = config.lastSaved || Date.now()` (a value of 0 becomes now), `source = config.source || 'Lexical'` (:33-46).
- [ ] **FILE-03** `editorStateFromSerializedDocument(editor, doc | string)`: a string is JSON-parsed, then `editor.parseEditorState(json.editorState)`. `version`, `source`, and `lastSaved` are not validated or used (:54-63).
- [ ] **FILE-04** `importFile(editor)`: a file picker (`accept='.lexical'`) reads UTF-8 text, then `setEditorState(parsed)` and dispatches CLEAR_HISTORY_COMMAND (:69-97).
- [ ] **FILE-05** `exportFile(editor, {fileName?, source?})`: `lastSaved = now`; file name `${fileName || now.toISOString()}.lexical`; contents are compact `JSON.stringify(doc)` with blob type `octet/stream` (:105-145).

---

#### 4. React plugins with model behaviour

- [ ] **RX-TAB-01** TabIndentation (lexical-extension/src/TabIndentationExtension.ts:76-132; lexical-react/src/LexicalTabIndentationPlugin.tsx): KEY_TAB at EDITOR priority, RangeSelection only, always preventDefault. It indents or outdents (Shift) when a selected block can indent, or when the earliest point sits at the normalized start of its nearest block and that block can indent. Otherwise it dispatches INSERT_TAB_COMMAND (:40-68, 84-100).
- [ ] **RX-TAB-02** INDENT_CONTENT_COMMAND at CRITICAL priority, overriding the core handler: for each block (via `$handleIndentAndOutdent`) where `$canIndent(block)` holds (default `block.canIndent()`), `newIndent = indent+1` is applied only if `!maxIndent || newIndent < maxIndent`. maxIndent N therefore allows indent levels 0 to N-1, and 0 or null means unlimited (:102-130). Outdent is left to core.
- [ ] **RX-TAB-03** TabIndentationExtension config `{disabled:false, maxIndent:null, $canIndent}`; registers only while not disabled (:134-167).
- [ ] **RX-LIST-01** ListPlugin `{hasStrictIndent=false, shouldPreserveNumbering=false}` throws without ListNode and ListItemNode. It calls `registerList(editor, {restoreNumbering})`, adds the strict-indent transform when requested, and also calls `useList(editor)`, which calls `registerList(editor)` a second time without options (lexical-react/src/LexicalListPlugin.ts:34-60). **AMBIGUOUS**: two INSERT_PARAGRAPH handlers at LOW priority; which one runs first decides restoreNumbering.
- [ ] **RX-LIST-02** registerList: INSERT_ORDERED/UNORDERED_LIST call `$insertList`; REMOVE_LIST calls `$removeList`; UPDATE_LIST_START `{listNodeKey, newStart}` sets start and renumbers number lists; INSERT_PARAGRAPH calls `$handleListInsertParagraph(restoreNumbering)`. A ListItem transform syncs the item's textStyle and textFormat from its first TextNode child, or from a collapsed selection on an empty item. A TextNode transform syncs the parent ListItem when the text is its first child (lexical-list/src/registerList.ts:50-148).
- [ ] **RX-LIST-03** Strict indent (registerListStrictIndentTransform), a ListNode transform walking breadth-first through nested lists. For each non-wrapper item: with no ancestor item that has a previous sibling, a positive indent is reset to 0. Otherwise, when this list's depth exceeds the previous item's deepest-end list depth + 1, the item is set to `setIndent(prevDepth)`. No level may be skipped (lexical-list/src/registerList.ts:150-231).
- [ ] **RX-CHECK-01** CheckList (lexical-list/src/checkList.ts:51-268): INSERT_CHECK_LIST calls `$insertList('check')`. While a check `<li>` is focused, Space toggles `checked` (when editable), Escape refocuses root, and ArrowUp/Down move to the previous or next non-wrapper item (crossing nesting), select its start, and focus its DOM node. ArrowLeft at offset 0 of the first descendant of a check item focuses that `<li>`.
- [ ] **RX-CHECK-02** Check click: a click or touch pointerup on an `<li>` of a `check` list (not a nested-list wrapper) toggles it when the X coordinate (zoom-adjusted) falls within the `::before` marker width from the start edge (RTL aware), with 32px extra padding for touch. Clicks within 500ms on the same element are deduplicated. `disableTakeFocusOnClick` tags the update SKIP_SELECTION_FOCUS and SKIP_DOM_SELECTION and stops propagation; otherwise the `<li>` is focused (:270-388). The model rule is `ListItemNode.toggleChecked()`; hit-testing is view-layer.
- [ ] **RX-HR-01** HorizontalRuleNode: a DecoratorNode with type `'horizontalrule'`, `getTextContent() = '\n'`, block-level, importDOM `<hr>`, exportDOM `<hr>`. INSERT_HORIZONTAL_RULE_COMMAND (RangeSelection only, EDITOR priority) calls `$insertNodeToNearestRoot(hr)`. A click on the HR toggles it in a NodeSelection; Shift adds to the existing NodeSelection (lexical-extension/src/HorizontalRuleExtension.ts:48-240). The React subclass is the same model with a React decorator (lexical-react/src/LexicalHorizontalRuleNode.tsx:85-123; LexicalHorizontalRulePlugin.ts:25-52).
- [ ] **RX-DBN-01** DecoratorBlockNode: a block DecoratorNode (`isInline=false`, `canIndent=false`) with `__format: ElementFormatType` (default `''`), `setFormat`/`getFormat`. JSON `{...lexical, format}` (lexical-react/src/LexicalDecoratorBlockNode.ts:28-87).
- [ ] **RX-BWAC-01** BlockWithAlignableContents: while its node is selected, FORMAT_ELEMENT_COMMAND (LOW) applies the format to the DecoratorBlockNode under a NodeSelection, or under a RangeSelection to each DecoratorBlockNode or nearest block ancestor; returns true. Clicking the wrapper toggles the node in the NodeSelection (Shift keeps others) (lexical-react/src/LexicalBlockWithAlignableContents.tsx:53-105).
- [ ] **RX-NSEL-01** useLexicalNodeSelection(key) returns `[isSelected, setSelected, clear]`. setSelected creates a NodeSelection if none exists, then adds or deletes the key; clear empties an existing NodeSelection (lexical-react/src/useLexicalNodeSelection.ts:57-114).
- [ ] **RX-CLEAR-01** ClearEditor: CLEAR_EDITOR_COMMAND (EDITOR priority) runs `$onClear` in an update. The default clears root, appends one empty paragraph, selects it if a selection existed, and resets the RangeSelection format to 0 (lexical-extension/src/ClearEditorExtension.ts:24-70; lexical-react/src/LexicalClearEditorPlugin.ts).
- [ ] **RX-TOC-01** TableOfContentsPlugin keeps an ordered list of `[key, textContent, tag]` HeadingNode entries, starting from a recursive walk of root (headings nested in elements included) (lexical-react/src/LexicalTableOfContentsPlugin.tsx:150-170).
- [ ] **RX-TOC-02** Heading mutations: on `created`, the entry is inserted after the previous heading in document order (found by walking `$getNextRightPreorderNode`), or at the front, de-duplicated. `destroyed` removes it. `updated` re-positions it. A TextNode `updated` whose parent is a heading refreshes that entry's text. An update listener re-positions every heading under dirty top-level elements (:36-136, 172-267).
- [ ] **RX-TOC-03** **AMBIGUOUS**: only top-level dirty elements trigger the re-position pass, and a text update only refreshes text when the text's direct parent is the heading (so not text inside a link inside a heading).
- [ ] **RX-EMBED-01** AutoEmbed: `URL_MATCHER = /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/` (lexical-react/src/LexicalAutoEmbedPlugin.tsx:57-58).
- [ ] **RX-EMBED-02** On a LinkNode or AutoLinkNode `created` mutation in an update tagged PASTE with at most 3 dirty leaves, each config's `parseUrl(url)` (which may be async) is tried. Every match sets the active config, so the last matching config wins (no break). Any other mutation of the tracked key resets it (:165-211).
- [ ] **RX-EMBED-03** Embed action: re-parse the URL, then in an update select the link end if there is no selection, call `insertNode(editor, result)`, and remove the link if still attached. INSERT_EMBED_COMMAND(type) opens a modal for the config of that type (EDITOR priority) (:213-262).
- [ ] **RX-TA-01** `PUNCTUATION = \.,\+\*\?\$\@\|#{}\(\)\^\-\[\]\\/!%'"~=<>_:;` (regex-escaped string) (lexical-react/src/LexicalTypeaheadMenuPlugin.tsx:36-37).
- [ ] **RX-TA-02** `useBasicTypeaheadTriggerMatch(trigger, {minLength=1, maxLength=75, punctuation=PUNCTUATION, allowWhitespace=false})` builds `(^|\s|\()([TRIGGER]((?:[^TRIGGER + PUNCT + (\s unless allowWhitespace)]){0,max}))$`. The match must have `len(group3) >= minLength` and returns `{leadOffset: index + len(group1), matchingString: group3, replaceableString: group2}`. The trigger is interpolated unescaped into a character class (:147-193). **AMBIGUOUS**: a trigger like `]` or `^` breaks the regex.
- [ ] **RX-TA-03** Typeahead text source: only a collapsed RangeSelection with a text anchor on a simple TextNode; the text is the node content up to the caret, so it never spans nodes (:39-50, 79-89).
- [ ] **RX-TA-04** The menu closes when the editor is read-only, the selection is not collapsed or not text, or nothing matches. It stays closed when `leadOffset == 0` and the previous sibling is a text entity (unless `ignoreEntityBoundary`). Nothing is evaluated while composing (:267-319).
- [ ] **RX-TA-05** On select, `$splitNodeContainingQuery` extends the replaced span: the query offset is the largest i between `len(replaceableString)` and `len(matchingString)` such that the last i characters of the text before the caret equal the first i of the option's matchingString. The text node is split at `[caret - i, caret]` and that node is passed to `onSelectOption` (lexical-react/src/shared/LexicalMenu.tsx:108-159). **AMBIGUOUS**: `getFullMatchOffset` is called with `match.matchingString`, not the option title, so it rarely extends beyond `replaceableString`.
- [ ] **RX-TA-06** Menu keys at the plugin's priority (default LOW): Down and Up move the highlight with wrap-around and always return true while open; Escape closes; Tab and Enter (not Shift+Enter) select the highlighted option. The first item is preselected by default, and the highlight resets to 0 when the query changes (lexical-react/src/shared/LexicalMenu.tsx:336-583).
- [ ] **RX-NODEMENU-01** LexicalNodeMenuPlugin opens a menu anchored at a node key, and repositions or closes it when that element is dirty. The menu is not split by a query (lexical-react/src/LexicalNodeMenuPlugin.tsx:43-131).
- [ ] **RX-SAOD-01** SelectionAlwaysOnDisplay is view-only: while the DOM selection is outside the editor, it draws the Lexical selection with `markSelection`. There is no model change (lexical-utils/src/selectionAlwaysOnDisplay.ts:13-52).
- [ ] **RX-MDSC-01** MarkdownShortcutPlugin `{transformers = DEFAULT_TRANSFORMERS}` calls `registerMarkdownShortcuts` (see MD-ARR-07 for HR) (lexical-react/src/LexicalMarkdownShortcutPlugin.tsx:44-56).
- [ ] **RX-HASH-01** HashtagPlugin throws without HashtagNode and calls `registerLexicalHashtag` (lexical-react/src/LexicalHashtagPlugin.ts:15-26).
- [ ] **RX-CHARLIM-01** CharacterLimitPlugin: see OVF-04 to OVF-11.
- [ ] **RX-ONCHANGE-01** OnChangePlugin calls `onChange(editorState, editor, tags)` unless `ignoreSelectionChange` is set and nothing is dirty, or `ignoreHistoryMergeTagChange` (default true) is set and the update has the HISTORY_MERGE tag. It never fires when the previous state was empty (the initial update) (lexical-react/src/LexicalOnChangePlugin.ts:16-52).
- [ ] **RX-AUTOFOCUS-01** AutoFocusPlugin calls `editor.focus(cb, {defaultSelection: 'rootStart' | 'rootEnd'})` (lexical-react/src/LexicalAutoFocusPlugin.ts:16-41). Model part: initial selection at the root start or end.
- [ ] **RX-HIST-01** HistoryPlugin `{delay=1000, externalHistoryState?}` calls `registerHistory(editor, state || createEmptyHistoryState(), delay)` (lexical-react/src/shared/useHistory.ts:15-28).
- [ ] **RX-TABLE-01** TablePlugin `{hasCellMerge=true, hasCellBackgroundColor=true, hasTabHandler=true, hasHorizontalScroll=false, hasNestedTables=false}`. `!hasCellMerge` registers the unmerge transform; `!hasCellBackgroundColor` adds a TableCellNode transform that nulls `backgroundColor`. Also registerTablePlugin (with a nested-tables signal) and registerTableSelectionObserver (lexical-react/src/LexicalTablePlugin.ts:56-109).
- [ ] **RX-EMPTY-01** `useLexicalIsTextContentEmpty(editor, trim?)` maps to TXT-08. `useCanShowPlaceholder` maps to TXT-09 and re-evaluates on updates and editable changes (lexical-react/src/useLexicalIsTextContentEmpty.ts; shared/useCanShowPlaceholder.ts).
- [ ] **RX-RT-01** RichTextPlugin and PlainTextPlugin call `registerRichText` / `registerPlainText` plus `registerDragonSupport`; their behaviour belongs to those packages (lexical-react/src/shared/useRichTextSetup.ts, usePlainTextSetup.ts).
- [ ] **RX-DRAG-01** DraggableBlockPlugin_EXPERIMENTAL model rule: on drop of a dragged top-level node key (`dataTransfer` custom format) onto a target block, `targetNode.insertAfter(dragged)` if the zoom-adjusted pointer Y is at or below the target's top, else `insertBefore`. Dropping on itself is a no-op; file drops are ignored (lexical-react/src/LexicalDraggableBlockPlugin.tsx:379-418).
- [ ] **RX-NODEEVT-01** NodeEventPlugin: a root DOM listener resolves the nearest node of the given class (`mouseenter` and `mouseleave` need an exact class match; other events take the nearest matching ancestor) and calls the listener with its key inside an update. View-layer (lexical-react/src/LexicalNodeEventPlugin.ts:16-71).
- [ ] **RX-SKIP-01** Not model (skip or keep in the JS layer): Composer, NestedComposer, ContentEditable, ErrorBoundary, EditorRefPlugin, TreeView, Collaboration/useYjsCollaboration (reference yjs), NodeContextMenuPlugin, extension and React glue, useLexicalEditable, useLexicalSubscription, useLexicalTextEntity (a wrapper over TXT-01).

### 3C — Behaviour inventory C: tables, lists, code (Lexical v0.45.0)

Source root: `target/lexical-upstream/packages`. Paths below are relative to it.
Tags: **MODEL** = pure editor-state logic (portable, testable headless); **VIEW** = DOM/CSS/event plumbing; **BRIDGE** = command/key/selection handlers that translate input into model mutations (need DOM geometry or events but mutate the model).
`T/` = `lexical-table/src/`, `L/` = `lexical-list/src/`, `C/` = `lexical-code-core/src/`, `P/` = `lexical-code-prism/src/`, `S/` = `lexical-code-shiki/src/`.

#### Macro patches touching this area

- [ ] **PATCH-TBL-1** MODEL `TableObserver.$clearText` patched: in each cleared cell Macro appends a **childless** `ParagraphNode` instead of upstream's `ParagraphNode > TextNode("")`, then removes all other children. Reason: the empty TextNode got removed by the text normalizer mid-transform and threw `"__first" is read-only` under the Loro collab layer. Guard test `plugins/tables/tableClear.test.ts:135`. Port: implement the patched behaviour (no empty text node) (`T/LexicalTableObserver.ts:555-566`; patch [table patch](../../../apps/web/patches/%40lexical%252Ftable%400.45.0.patch)).
- [ ] **PATCH-MD-1** (cross-ref, list-related) `@lexical/markdown` `LIST_INDENT_SIZE` 4 -> 2: nested list markdown import divides leading spaces by 2, export uses `" ".repeat(2*depth)`. Port should make list-indent width configurable, default 2 for Macro ([markdown patch](../../../apps/web/patches/%40lexical%252Fmarkdown%400.45.0.patch)). Nothing in `@lexical/list` itself is patched.
- [ ] **PATCH-NONE** No Macro patch exists for `@lexical/list`, `@lexical/code*`.

---

#### 1. @lexical/table

##### 1.1 TableCellNode (`T/LexicalTableCellNode.ts`)

- [ ] **TBL-CELL-1** MODEL type `"tablecell"`; fields `__colSpan`(default 1), `__rowSpan`(default 1, not a ctor arg), `__headerState`(default 0), `__width?: number`, `__backgroundColor: string|null`(default null), `__verticalAlign?: string` (`:59-139`).
- [ ] **TBL-CELL-2** MODEL `TableCellHeaderStates` = `{NO_STATUS:0, ROW:1, COLUMN:2, BOTH:3}` bitmask (`:36-41`).
- [ ] **TBL-CELL-3** MODEL `setHeaderStyles(state, mask=BOTH)` = `(state & mask) | (old & ~mask)`; `toggleHeaderStyle(s)` subtracts `s` if all bits of `s` set else **adds** `s` (arithmetic, not OR: toggling BOTH when only ROW is set yields 1+3=4) **AMBIGUOUS**: upstream bug-for-bug; port should probably use XOR/OR (`:235-288`).
- [ ] **TBL-CELL-4** MODEL `hasHeaderState(s)` = all bits of s set; `hasHeader()` = state != 0; tag `th` if hasHeader else `td` (`:231-296`).
- [ ] **TBL-CELL-5** MODEL `setVerticalAlign(v)` stores `v || undefined`; only `"middle"`/`"bottom"` are "valid": exported to JSON and DOM only when valid (`:272-330`).
- [ ] **TBL-CELL-6** MODEL JSON: `{...element, verticalAlign?(valid only), backgroundColor, colSpan, headerState, rowSpan, width}`; import uses `colSpan||1`, `rowSpan||1`, `width||undefined`, `backgroundColor||null`, `verticalAlign||undefined` (`:113-208`).
- [ ] **TBL-CELL-7** MODEL `clone` passes headerState/colSpan/width/key; `afterCloneFrom` copies rowSpan, bg, valign, colSpan, header, width (`:77-94`).
- [ ] **TBL-CELL-8** MODEL `isShadowRoot()=true`, `collapseAtStart()=true`, `canBeEmpty()=false`, `canIndent()=false` (`:309-323`).
- [ ] **TBL-CELL-9** VIEW `createDOM`: `<th|td>`, `style.width=Npx` if width truthy, `colSpan`/`rowSpan` attrs only if >1, `style.backgroundColor` if non-null, `style.verticalAlign` if valid, classes `theme.tableCell` + `theme.tableCellHeader` when header (`:141-167`). `updateDOM` returns true (recreate) if any of header/width/colSpan/rowSpan/bg/valign changed (`:298-307`).
- [ ] **TBL-CELL-10** VIEW `exportDOM`: adds `data-temporary-table-cell-lexical-key` (consumed by TableNode export), `border:1px solid black`, `width = (width||75)px` (`COLUMN_WIDTH=75`, `T/constants.ts:13`), `verticalAlign = valign||'top'`, `textAlign:start`, header with null bg gets `#f2f3f5` (`:169-195`).
- [ ] **TBL-CELL-11** BRIDGE HTML import (`td`/`th`, priority 0): width from `style.width` matching `/^(\d+(?:\.\d+)?)px$/`; `th` header state: `scope=col`->COLUMN, `scope=row`->ROW, else ROW if row is in `thead` or `rowIndex==0`, plus COLUMN if `cellIndex==0`, and fallback ROW if neither; `td` -> 0. rowSpan from attr, bg from `style.backgroundColor`, valid valign (`:332-389`).
- [ ] **TBL-CELL-12** BRIDGE HTML import `after`: runs of inline/text/linebreak children wrapped in a ParagraphNode; block children pushed as-is; a paragraph whose only child is a LineBreak gets the LineBreak removed; empty result -> one empty paragraph. Cell `font-weight 700|bold`, `font-style italic`, `text-decoration underline|line-through` toggle formats on text children; `color` appended to text style unless it already has `color:` (`:391-464`). New import-rule path does the same via `ImportTextFormat`/`ImportTextStyle` context (`T/TableImportExtension.ts:58-251`).

##### 1.2 TableRowNode (`T/LexicalTableRowNode.ts`)

- [ ] **TBL-ROW-1** MODEL type `"tablerow"`; `__height?: number`; JSON includes `height` only if defined (`:38-83`).
- [ ] **TBL-ROW-2** MODEL `isShadowRoot()=true`, `canBeEmpty()=false`, `canIndent()=false`; `extractWithChild(_, _, dest)` = `dest==='html'` (`:97-129`).
- [ ] **TBL-ROW-3** VIEW `<tr>` with `style.height=Npx` if truthy, class `theme.tableRow`; `updateDOM` true iff height changed (`:85-121`).
- [ ] **TBL-ROW-4** BRIDGE HTML `tr` import: height from px style; children filtered by `$descendantsMatching(children, $isTableCellNode)` (non-cells dropped/unwrapped) (`:132-144`).

##### 1.3 TableNode (`T/LexicalTableNode.ts`)

- [ ] **TBL-TBL-1** MODEL type `"table"`; fields `__rowStriping=false`, `__frozenColumnCount=0`, `__frozenRowCount=0`, `__colWidths?: readonly number[]` (frozen in dev) (`:177-241`).
- [ ] **TBL-TBL-2** MODEL JSON: `colWidths`, and `frozenColumnCount`/`frozenRowCount`/`rowStriping` only when truthy (else `undefined`, omitted); import defaults false/0/0 (`:226-253`).
- [ ] **TBL-TBL-3** MODEL `canBeEmpty()=false`, `isShadowRoot()=true`, `canSelectBefore()=true`, `canIndent()=false`; `extractWithChild` html-only (`:255-601`).
- [ ] **TBL-TBL-4** MODEL `getColumnCount()` = sum of colSpan of **first row's** cells (ignores rowSpan intrusions from above; first row has none) (`:603-617`).
- [ ] **TBL-TBL-5** VIEW `createDOM`: `<table>` with `__style` applied, a `<colgroup>` first child marked unmanaged, class `theme.table`; `<col>` per column with `width:Npx` when colWidths[i] truthy; rowStriping -> class `theme.tableRowStriping` + `data-lexical-row-striping="true"`; alignment classes from `theme.tableAlignment.{center,right}` by `getFormatType()` (`:66-150,277-346`).
- [ ] **TBL-TBL-6** VIEW scroll wrapper: when scrollable tables active for the editor (`hasHorizontalScroll`), `createDOM` returns `<div class=theme.tableScrollableWrapper>` (or inline `overflow-x:auto` if no theme class) containing the table; frozen columns/rows add `theme.tableFrozenColumn/Row` on the wrapper and `data-lexical-frozen-column/row="true"` on the table. DEV warns if theme class missing. `getDOMSlot` targets the inner table, inserting after colgroup (`:152-174,263-321`).
- [ ] **TBL-TBL-7** VIEW `updateDOM` returns true (recreate) when the wrapper-ness of the DOM mismatches the current scroll flag; else patches wrapper + table in place (`:349-359`). Toggling `hasHorizontalScroll` triggers `editor.update($fullReconcile)` (no dirty nodes, no history entry) (`T/LexicalTableExtension.ts:72-83`).
- [ ] **TBL-TBL-8** VIEW `scaleDOMColWidths(dom, scale)` rewrites `<col>` widths scaled, without model change (`:361-372`).
- [ ] **TBL-TBL-9** VIEW `exportDOM`: unwraps the scroll div, applies alignment, uses table map to keep only `<col>`s for columns covered by exported cells (partial selection export), strips temp key attrs, moves `<tr>`s into a `<tbody>` (`:374-454`).
- [ ] **TBL-TBL-10** BRIDGE HTML `table` import (priority 1): `data-lexical-row-striping` -> striping; `data-lexical-frozen-column/row` -> count 1; colWidths from `colgroup > col` `style.width` px or integer `width` attr; any non-matching col aborts colWidths entirely; children filtered to TableRowNodes (`:632-668`, rule variant `T/TableImportExtension.ts:120-162`).
- [ ] **TBL-TBL-11** VIEW DOM-coordinate helpers `getCordsFromCellNode`, `getDOMCellFromCords` (x clamps to `row.length-1`), `getCellNodeFromCords[OrThrow]` operate on the observer's DOM grid, not the model map (`:464-563`).
- [ ] **TBL-TBL-12** MODEL import schema: `TableSchema` accepts only rows and packages a run of bare cells into a new row; `TableRowSchema` accepts only cells (`T/TableImportExtension.ts:260-279`).

##### 1.4 Table map (`T/LexicalTableUtils.ts`)

- [ ] **TBL-MAP-1** MODEL `$computeTableMapSkipCellCheck(table, a|null, b|null)`: 2-D array `map[row][col] = {cell, startRow, startColumn}`; walks rows in order, each cell placed at the first unoccupied column index of its row, and fills `rowSpan x colSpan` slots with the same value object. Asserts table children are rows and row children are cells (`:1040-1111`).
- [ ] **TBL-MAP-2** MODEL rowSpan overflowing past the last row is truncated silently (non-rectangular guard for #6584); rows may still be ragged (different lengths) (`:1086-1096`).
- [ ] **TBL-MAP-3** MODEL `$computeTableMap(table, a, b)` = skip-check variant + invariant both cells were found ("Anchor/Focus not found in Table") (`:1025-1038`).
- [ ] **TBL-MAP-4** MODEL `$getNodeTriplet(point|node|cell)` -> `[cell,row,table]` with invariants (`:1113-1145`).
- [ ] **TBL-MAP-5** MODEL `$computeTableCellRectBoundary(map, a, b)`: start from bounding box of a and b including spans, then iterate to fixpoint expanding to include every cell intersecting the box (handles ragged merges) (`:1183-1254`).
- [ ] **TBL-MAP-6** MODEL `$computeTableCellRectSpans(map, rect)`: max rowSpan across top/bottom rows and max colSpan across left/right columns (`:1161-1181`).
- [ ] **TBL-MAP-7** MODEL `$getTableCellNodeRect(cell)` -> `{rowIndex, columnIndex, rowSpan, colSpan}` via its own occupancy matrix (column count = first row's child count) (`:1332-1386`).
- [ ] **TBL-MAP-8** MODEL `$isSimpleTable`: all rows have same child count, every cell 1x1, >0 columns (`:1262-1287`).
- [ ] **TBL-MAP-9** MODEL legacy index helpers `$getTableRowIndexFromTableCellNode`, `$getTableColumnIndexFromTableCellNode` (child index, span-unaware), `$getTableCellNodeFromLexicalNode`, `$getTableRowNodeFromTableCellNodeOrThrow`, `$getTableNodeFromLexicalNodeOrThrow` (`:82-131`).

##### 1.5 Creation and structure ops (`T/LexicalTableUtils.ts`)

- [ ] **TBL-OP-1** MODEL `$createTableNodeWithDimensions(rows, cols, includeHeaders=true)`: `includeHeaders` bool -> row 0 gets ROW, col 0 gets COLUMN (cell [0][0] = BOTH); object `{rows, columns}` selects each independently. Each cell = `Paragraph > TextNode("")` (`:40-80`).
- [ ] **TBL-OP-2** MODEL `$insertTableRowAtNode(cell, after=true)`: after -> target row = `startRow+rowSpan-1`; for each column of that row, cells ending at that row get a new cell below, cells spanning further get `rowSpan+1`. before -> target = startRow; cells starting there get a new cell, cells started above get `rowSpan+1`. New cell header = `getHeaderState(src, COLUMN)` (COLUMN if src is BOTH or COLUMN, else 0); new cells contain an empty Paragraph (no TextNode). Returns new row (`:239-371`).
- [ ] **TBL-OP-3** MODEL `$insertTableRowAtSelection(after=true)` (alias `$insertTableRow__EXPERIMENTAL`): needs Range or Table selection; after -> uses whichever of anchor/focus cell ends lower; before -> whichever starts higher (ties -> anchor) (`:257-295`).
- [ ] **TBL-OP-4** MODEL `$insertTableColumnAtNode(cell, after=true, shouldSetSelection=true)`: insertAfterColumn = `startCol+colSpan-1` (after) or `startCol-1` (before). Per row: header via `getHeaderState(src, ROW)` from the cell at that column (col 0 if -1); col -1 -> insert first; if the cell at that column ends there, insert after it, but if that cell started on an earlier row (rowSpan intrusion) walk left (`prevCellIndex -= currentCell.__colSpan`) to a cell starting in this row, or append at row end if none; otherwise the spanning cell gets `colSpan+1`. Selects first inserted cell's start if requested. colWidths: duplicates width at `max(insertAfterColumn,0)` and inserts at that index (`:485-580`). **AMBIGUOUS**: the walk-left decrement uses the original cell's colSpan each step, not the visited cell's.
- [ ] **TBL-OP-5** MODEL `$insertTableColumnAtSelection(after=true)` (alias `__EXPERIMENTAL`): after -> anchor/focus cell ending further right; before -> whichever starts further left (`:440-478`).
- [ ] **TBL-OP-6** MODEL `$deleteTableRowAtSelection()` (alias `__EXPERIMENTAL`): orders anchor/focus by `isBackward`; row range `[first.startRow, second.startRow+second.rowSpan-1]` (document order) **AMBIGUOUS**: not min/max over both cells' spans, so a taller first cell (rowSpan reaching below the second cell) is under-deleted. If range covers all rows -> remove whole table (no selection fix). Else for each row bottom-up, each cell (once, at its start column): cells partially overlapping get rowSpan reduced by overlap; cells starting inside and extending below the range are moved into the next row after the last cell that starts in that row left of them (or first). Rows removed. Selection -> start of first cell of next row, else of previous row (`:608-713`).
- [ ] **TBL-OP-7** MODEL `$deleteTableColumnAtSelection()` (alias `__EXPERIMENTAL`): column range = min start .. max end of anchor/focus. All columns -> `table.selectPrevious()` then remove table. Per row: cells starting left of range shrink by overlap (once, at range start column), cells extending right shrink by in-range part (at range end column), fully-contained cells removed. Selection -> cell right of the range in focus row, else cell left of it. colWidths spliced (`:715-797`).
- [ ] **TBL-OP-8** MODEL `$moveSelectionToCell(cell)`: select start of the parent of the cell's first descendant, or `cell.selectStart()` (`:799-806`).
- [ ] **TBL-OP-9** MODEL legacy DOM-grid ops (deprecated, need `TableDOMTable`): `$insertTableRow(table, idx, after, count, domTable)` (new cells inherit width/COLUMN header from above/below), `$insertTableColumn(...)` (ROW header from left/right), `$deleteTableColumn(table, idx)` (child index, span-unaware), `$removeTableRowAtIndex` (`:154-237,376-433,585-606`).
- [ ] **TBL-OP-10** MODEL `$mergeCells(cells)`: bounding box of all given cells over the full map (does **not** expand to a rectangle beyond given cells' spans); target = cell at `[minRow][minCol]` gets colSpan/rowSpan of box; every other distinct cell in box: children appended to target unless the cell is a single empty Paragraph, then cell removed; empty target gets a Paragraph. Returns target or null for empty input (`:817-924`).
- [ ] **TBL-OP-11** MODEL `$unmergeCell()` (from selection anchor) / `$unmergeCellNode(cell)`: no-op if 1x1. Per new column `i`, COLUMN header bit kept only if every map cell in that column has it; per new row ROW bit kept only if every cell in that row has it. Inserts `colSpan-1` cells after it in its row, then for each subsequent spanned row inserts `colSpan` cells after the last cell that starts in that row left of startColumn (or first); new cells = empty Paragraph; sets spans to 1 (`:926-1023`).
- [ ] **TBL-OP-12** MODEL `$moveTableColumn(table, from, to)`: only for simple tables and in-range indices; reorders cells in every row and colWidths if length matches (`:1296-1330`).

##### 1.6 TableSelection (`T/LexicalTableSelection.ts`)

- [ ] **TBL-SEL-1** MODEL `TableSelection {tableKey, anchor, focus: PointType(element), _cachedNodes, dirty}`; anchor/focus keys are **cell** keys (`:111-126`).
- [ ] **TBL-SEL-2** MODEL `isValid()`: false if tableKey/anchor/focus key is `root` or points are not `element`, or any node missing (`:139-156`).
- [ ] **TBL-SEL-3** MODEL `isBackward()` = `focus.isBefore(anchor)`; `isCollapsed()` always false; `getStartEndPoints()=[anchor,focus]`; `is()` compares tableKey+points; `clone()`; `set(tableKey, anchorKey, focusKey)` marks dirty if changed and clears cache (`:163-207`).
- [ ] **TBL-SEL-4** MODEL `getNodes()`: [] if invalid; cached unless read-only mode. If focus cell's table differs from anchor table (nested), re-sets keys (to table's parent / focus cell's grid parent) and recurses. Else computes map + rect boundary (TBL-MAP-5) and returns, in insertion order: the table, then for each row in the rect its row node (once per contiguous run) and each cell plus all descendants (pre-order via `$visitRecursively`) (`:295-368`). **AMBIGUOUS**: the nested-table recovery sets an anchor key that is a non-cell node.
- [ ] **TBL-SEL-5** MODEL `getTextContent()`: for each selected cell, its text + `\t` between cells in a row, `\n` after last cell of a row (`:370-380`).
- [ ] **TBL-SEL-6** MODEL `getShape()` -> `{fromX,fromY,toX,toY}` from `$getTableCellNodeRect` of anchor and focus including spans (not the expanded rect) (`:256-293`).
- [ ] **TBL-SEL-7** MODEL `insertText()` / `insertRawText()` are no-ops (`:213-219`); typing with a TableSelection is handled by CONTROLLED_TEXT_INSERTION (TBL-CMD-8) which clears highlight and lets the default proceed. **AMBIGUOUS** what core then does with the TableSelection.
- [ ] **TBL-SEL-8** MODEL `hasFormat(type)`: OR of each selected cell's **first child paragraph's** `getTextFormat()`; true if flag set in any (`:228-241`).
- [ ] **TBL-SEL-9** MODEL `insertNodes(nodes)`: select all children of the focus cell (`focus.select(0, size)`), normalize, and insert there (`:243-253`).
- [ ] **TBL-SEL-10** MODEL `extract()` = `getNodes()` (`:209-211`).
- [ ] **TBL-SEL-11** MODEL `$createTableSelection()` (root/0 placeholder points); `$createTableSelectionFrom(table, anchorCell, focusCell)` clones current TableSelection or makes new, then `set`; DEV invariants that table is attached and both cells belong to it (`:387-436`).

##### 1.7 Transforms and normalization (`T/LexicalTablePluginHelpers.ts`)

- [ ] **TBL-NORM-1** MODEL cell transform: cell whose parent is not a row is removed; empty cell gets an empty Paragraph appended (`:110-118`).
- [ ] **TBL-NORM-2** MODEL row transform: row whose parent is not a table is removed; else `$unwrapAndFilterDescendants(row, $isTableCellNode)` (non-cell children unwrapped / dropped) (`:120-128`).
- [ ] **TBL-NORM-3** MODEL table transform: unwrap/filter children to rows; compute map; every row shorter than the max map row length gets new empty cells (`NO_STATUS`, empty Paragraph) appended to pad (`:130-164`).
- [ ] **TBL-NORM-4** MODEL table transform colWidths repair: if length != columnCount, truncate, or extend by repeating the last width; empty array stays `undefined` result (`:165-180`).
- [ ] **TBL-NORM-5** MODEL `hasCellMerge=false` -> `registerTableCellUnmergeTransform`: any cell with span>1 triggers whole-table split: each non-origin slot covered by a merged cell gets a new cell (copying that cell's headerState, **no paragraph**; TBL-NORM-1 fills it) inserted after the last origin cell in that row or first; then all origin cells set to 1x1 (`:267-320`).
- [ ] **TBL-NORM-6** MODEL `hasCellBackgroundColor=false` -> cell transform clearing any non-null backgroundColor (`T/LexicalTableExtension.ts:93-101`).

##### 1.8 Plugin commands (`T/LexicalTablePluginHelpers.ts`, `registerTablePlugin`)

- [ ] **TBL-PLG-1** MODEL `registerTablePlugin` asserts TableNode is registered; registers INSERT_TABLE (EDITOR prio), SELECTION_INSERT_CLIPBOARD_NODES (EDITOR, same-editor only), SELECT_ALL (LOW), CLICK (EDITOR), and the three transforms (`:402-447`).
- [ ] **TBL-PLG-2** MODEL `INSERT_TABLE_COMMAND {rows: string, columns: string, includeHeaders?}`: uses current or previous selection; must be RangeSelection; if `!hasNestedTables` and anchor is inside a table -> returns false (no insert). Builds table (TBL-OP-1, `Number()` parse), `$insertNodeToNearestRoot`, selects the first text node (`:81-108`, `T/LexicalTableCommands.ts:13-27`).
- [ ] **TBL-PLG-3** BRIDGE triple-click (`CLICK_COMMAND`, `detail>=3`): if the clicked node's nearest block is a direct child of a cell, `block.select(0)` = anchor offset 0, focus defaults to childrenSize, i.e. selects the whole block's content (not the whole cell, not past the cell) and handled (`:183-204`; `lexical/src/nodes/LexicalElementNode.ts:367-394`); observer also `preventDefault`s mousedown with `detail>=3` on cells so the native triple-click does not escape the cell (`T/LexicalTableSelectionHelpers.ts:398-413`).
- [ ] **TBL-PLG-4** MODEL SELECT_ALL: only when RangeSelection anchor is in a table **and** that table is the root's only child -> TableSelection from map[0][0] to last cell of last map row; otherwise default select-all (`:206-258`). Select-all inside a cell with other root content falls through to core.
- [ ] **TBL-PLG-5** MODEL paste (`SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`): no table anywhere in pasted nodes (deep `$dfs`) -> not handled. Selection not in grid (Range with anchor and focus both in cells, or TableSelection) -> not handled. Exactly one pasted node that is a table -> grid paste (TBL-PLG-6) even with nested tables allowed. Else if Range selection and `hasNestedTables` and not multi-cell -> not handled (nested insert). Else -> **swallowed (paste rejected, returns true)** (`:449-498`). Non-table paste into a TableSelection is not handled here; core inserts into the focus cell via TBL-SEL-9.
- [ ] **TBL-PLG-6** MODEL `$insertTableIntoGrid(template, sel)`: origin = anchor cell (Range) or TableSelection rect min corner; affected size = template size, or `min(template, selection rect)` for TableSelection (no growth beyond selection, template truncated). Step 1 unmerge every merged cell in affected area. Step 2 grow: append `rowsToInsert` rows after last row (`$insertTableRowAtNode` on `map[lastRow][0]`) and columns after last column (no selection move). Step 3 for each template origin cell in area: merge target cells to match template spans (clipped to area); copy non-null bg; append template's children and remove the target's original children. If TableSelection and any merge/unmerge happened, `selectEnd` of cell at original anchor coords (`:500-675`). **AMBIGUOUS** bug: template TextNode children are wrapped in a new Paragraph, but then the raw TextNode (not the paragraph) is appended to the cell (`:649-653`).
- [ ] **TBL-PLG-7** MODEL `$isMultiCellTableSelection`: TableSelection with anchor != focus node, or Range whose anchor node is a cell and differs from focus node (`:677-694`).

##### 1.9 Observer registration (`registerTableSelectionObserver`, `T/LexicalTablePluginHelpers.ts:322-392`)

- [ ] **TBL-OBS-1** VIEW one `TableObserver` per TableNode key, created on mutation `created`/`updated` (with `skipInitialization:false`, so existing tables get one), recreated if the table's DOM element changed, destroyed on `destroyed`; cleanup removes all listeners (`:353-391`).
- [ ] **TBL-OBS-2** VIEW observer attaches itself to the `<table>` element under `__lexicalTableSelection` (invariant: only one) (`T/LexicalTableSelectionHelpers.ts:1143-1171`).
- [ ] **TBL-OBS-3** VIEW observer keeps a DOM grid `TableDOMTable {domRows[y][x] = {elem, highlighted, hasBackgroundColor, x, y}, rows, columns}` built by walking `tr`/`td|th` DOM (x = DOM child index, span-unaware) and stamping `elem._cell`; rebuilt by a MutationObserver when a TABLE/TBODY/THEAD/TR mutates (`T/LexicalTableObserver.ts:228-272`, `T/LexicalTableSelectionHelpers.ts:1263-1337`).
- [ ] **TBL-OBS-4** VIEW highlight: selected cells get `theme.tableCellSelected`; table gets `theme.tableSelection` while a TableSelection is active ("hijacked selection styles"); empty `style` attrs removed; native DOM selection ranges removed while a cell range is active (`T/LexicalTableObserver.ts:274-352`, `T/LexicalTableSelectionHelpers.ts:1339-1422,1732-1755`).
- [ ] **TBL-OBS-5** VIEW whole-table highlight when `tableNode.isSelected()` (e.g. range selection spanning it) and removal when not (`T/LexicalTableSelectionHelpers.ts:1133-1140`).
- [ ] **TBL-OBS-6** BRIDGE `$setAnchorCellForSelection(domCell)`: resets highlighting/focus state, records anchor coords, builds/clones a TableSelection with anchor=focus=that cell (not set as editor selection) (`T/LexicalTableObserver.ts:451-486`).
- [ ] **TBL-OBS-7** BRIDGE `$setFocusCellForSelection(domCell, ignoreStart=false)`: enables highlighting if ignoreStart, focus != anchor coords, or a selection+anchor exist; no-op if same focus coords; else builds TableSelection(anchorCell, focusCell), `$setSelection`, dispatches SELECTION_CHANGE, repaints. Coordinate fallback when DOM lookup fails (`:354-425`).
- [ ] **TBL-OBS-8** MODEL `$formatCells(type)`: for each selected cell, a RangeSelection over the whole cell (element 0..childrenSize) runs `formatText(type, alignWith)` where `alignWith` = first selected cell's first paragraph `getFormatFlags(type, null)` (so all cells become consistently on/off); selection restored to the TableSelection; SELECTION_CHANGE dispatched (`:488-514`).
- [ ] **TBL-OBS-9** MODEL `$clearText()`: if selected cells' first == first row's first child **and** last == last row's last child -> whole table: `selectPrevious()`, remove table, and if parent is root and now empty dispatch INSERT_PARAGRAPH. Else each selected cell reset to one empty paragraph (see PATCH-TBL-1), highlight cleared, selection set to **null**, SELECTION_CHANGE dispatched (`:516-574`).

##### 1.10 Pointer / mouse selection (`T/LexicalTableSelectionHelpers.ts`)

- [ ] **TBL-PTR-1** BRIDGE window `pointerdown` (primary button, inside root; via root listener so it attaches after mount): if current selection is a TableSelection, clear highlight on every observer and set selection null; then if target is in an observed cell run `$handleTableClick` (`:179-237`).
- [ ] **TBL-PTR-2** BRIDGE click: Firefox+shift with prior selection in this table: if prior anchor in a cell -> TableSelection from that cell to clicked cell; else extend range to table start/end keeping prior anchor. Otherwise set anchor cell unless `pointerType==='touch'` (taps never start cell selection) (`:330-370`).
- [ ] **TBL-PTR-3** BRIDGE drag: on pointerdown registers window `pointermove`/`pointerup`; move without button 1 ends selecting; target cell from event target, or (Firefox / target outside table) by `elementsFromPoint`; when focus cell changes, records `nextFocus` and dispatches SELECTION_CHANGE; SELECTION_CHANGE handler then extends TableSelection (`:251-328`, `:838-884`).
- [ ] **TBL-PTR-4** BRIDGE range->table conversion on SELECTION_CHANGE (`$fixRangeSelectionForSelectedTable`): RangeSelection with anchor and focus in **different cells of the same table** becomes a TableSelection (covers shift+click and native drag across cells); touch drag (`isSelecting`) between collapsed selections in different cells also converts (`:947-1065`).
- [ ] **TBL-PTR-5** MODEL range spanning into/out of a table: if focus is in a table the anchor is not in (or anchor table is an ancestor), focus snaps to cover the whole focus table (last cell end, or first cell start if backward); symmetric for anchor (`:972-1014`).
- [ ] **TBL-PTR-6** BRIDGE TableSelection whose DOM focus left the table (and selection unchanged from previous) becomes a RangeSelection from DOM with anchor at table element offset 0 (or childrenSize if backward) (`:1070-1102`).
- [ ] **TBL-PTR-7** BRIDGE Firefox scroll workaround: arrow-down from outside into a scrollable table that lands not in the first cell moves to first cell start (`:885-918,2084-2087`).

##### 1.11 Keyboard (`applyTableHandlers`, all HIGH priority)

- [ ] **TBL-KEY-1** BRIDGE arrows suppressed (return false) for up/down while root `aria-controls="typeahead-menu"` (`:2285-2296`).
- [ ] **TBL-KEY-2** BRIDGE ArrowLeft into a table from the following block: collapsed-at-offset-0 caret whose block's previous sibling is a table -> `table.selectEnd()`; with shift, focus set to before the table at parent element level (`:1916-1941`).
- [ ] **TBL-KEY-3** BRIDGE shift+Up/Down from outside a table: if extending would shrink back over the table -> focus jumps past the table to adjacent sibling (end of previous / start of next); if focus is root/shadow-root and range covers a cell -> full-table TableSelection; if next/prev block sibling is this table -> range focus jumps to last cell end / first cell start (whole table covered) (`:1942-2083`).
- [ ] **TBL-KEY-4** BRIDGE Left/Right in a cell, RangeSelection: if caret can move within text, default. Else at cell edge: `move` -> caret to adjacent cell (next/prev in document order, crossing rows) or exits table to adjacent block; `extend` (shift) -> TableSelection anchor cell..adjacent cell, or the single cell if at table edge (`:1788-1895`).
- [ ] **TBL-KEY-5** BRIDGE Up/Down collapsed in a cell: compares caret rect with the first/last child block rect of the cell (geometry); if on the first/last visual line: no shift -> move to cell above/below at same DOM x (selectEnd going up, selectStart going down) or `table.selectPrevious/Next()` at edge; shift -> single-cell TableSelection. Nested tables delegate to inner table (`:2105-2211,1456-1522`).
- [ ] **TBL-KEY-6** BRIDGE Left/Right (non-shift, via DOM grid): `selectTableNodeInDirection` wraps rows: forward at last column goes to row+1 col 0, at last cell `selectNext()`; backward symmetric (`:1463-1494`).
- [ ] **TBL-KEY-7** BRIDGE arrows with TableSelection: no shift -> collapse to `focusCell.selectEnd()`; shift -> `$adjustFocusInDirection`: moves focus corner one cell (stepping over spans using rect spans), recomputes rectangular rect via `$extractRectCorners` (keeps anchor's corner if anchor is on a corner, else new focus corner, else min/min) and re-anchors; returns false at table edge (`:1524-1687,2212-2274`).
- [ ] **TBL-KEY-8** BRIDGE Escape with TableSelection -> `focusCell.selectEnd()` (`:433-454`).
- [ ] **TBL-KEY-9** BRIDGE Tab (when `hasTabHandler`, default true): only for collapsed RangeSelection inside this table and the nearest cell's table is this table: Tab -> `selectEnd()` of next cell (next sibling, else first cell of next row), Shift+Tab -> previous cell (prev sibling, else last cell of previous row); past the last/first cell -> `table.selectNext()/selectPrevious()`. **No new row is created** by Tab in core (`:762-795,1424-1452`). Non-collapsed or TableSelection Tab falls through.
- [ ] **TBL-KEY-10** MODEL Backspace/Delete (KEY_BACKSPACE/KEY_DELETE): if exactly one of anchor/focus is inside this table, the selection is expanded around the table (`selectPrevious`/`selectNext` with the outer point restored) and default delete handles it (removes table). TableSelection in table -> preventDefault + `$clearText()` (`:532-588`).
- [ ] **TBL-KEY-11** MODEL DELETE_CHARACTER/WORD/LINE: TableSelection -> `$clearText()`; Range half in table -> `$clearText()` **AMBIGUOUS** ($clearText asserts TableSelection, would throw); DELETE_LINE in first block of a cell swallowed (TODO) (`:456-530`).
- [ ] **TBL-KEY-12** MODEL CUT: Range or Table selection: copy clipboard data first, then delete handler; for RangeSelection additionally `removeText()` and handled (`:590-617`).
- [ ] **TBL-KEY-13** MODEL FORMAT_TEXT with TableSelection in this table -> `$formatCells` (TBL-OBS-8); Range selection -> default (`:619-648`).
- [ ] **TBL-KEY-14** MODEL FORMAT_ELEMENT with TableSelection whose anchor/focus are cells: full-table selection -> `table.setFormat(type)` (table alignment); else every distinct cell in rect and each non-inline element child gets `setFormat(type)` (`:650-715`).
- [ ] **TBL-KEY-15** BRIDGE CONTROLLED_TEXT_INSERTION: TableSelection -> clear highlight (selection set null) and not handled. Range in cell with string payload and DOM caret outside the table element but inside its parent (caret positioned before/after table): if anchor cell is first cell -> new paragraph with the text inserted before the table; last cell -> after (`:717-760,2298-2382`).
- [ ] **TBL-KEY-16** BRIDGE INSERT_PARAGRAPH (Enter) with same edge condition -> inserts empty paragraph before/after the table and selects it (`:807-832`).
- [ ] **TBL-KEY-17** BRIDGE FOCUS_COMMAND -> returns `tableNode.isSelected()` (`:797-805`).
- [ ] **TBL-KEY-18** MODEL copy of a TableSelection: core clipboard serializes `getNodes()` (table+rows+cells subset); `extractWithChild` html-only for table/row; TableNode.exportDOM trims colgroup (TBL-TBL-9). No COPY handler in this package.

##### 1.12 TableExtension (`T/LexicalTableExtension.ts`)

- [ ] **TBL-EXT-1** MODEL name `@lexical/table/Table`; nodes `[TableNode, TableRowNode, TableCellNode]`; config defaults `hasCellMerge:true, hasCellBackgroundColor:true, hasTabHandler:true, hasHorizontalScroll:true, hasNestedTables:false` (experimental); config exposed as reactive signals (`:26-68`).
- [ ] **TBL-EXT-2** MODEL each flag is live (effect): toggling re-registers the selection observer (tab handler), unmerge transform, bg-strip transform, scroll wrapper; `hasNestedTables` read via `peek()` at command time (`:69-103`).
- [ ] **TBL-EXT-3** MODEL `TableImportExtension` (`@lexical/table/Import`) = Core import + TableExtension + DOM import rules for table/tr/td/th (`T/TableImportExtension.ts:287-302`).

---

#### 2. @lexical/list

##### 2.1 ListNode (`L/LexicalListNode.ts`)

- [ ] **LST-NODE-1** MODEL type `"list"`; `__listType: 'number'|'bullet'|'check'` (default number), `__tag: 'ol'` iff number else `'ul'` (derived, stored), `__start` (default 1). Ctor also accepts `'ol'/'ul'` as listType aliases (`:50-90,366-369`).
- [ ] **LST-NODE-2** MODEL `setListType(t)` updates tag; `setStart(n)`; JSON `{listType, start, tag}`; import sets listType then start (tag recomputed, JSON `tag` ignored) (`:103-186`).
- [ ] **LST-NODE-3** MODEL `canBeEmpty()=false`, `canIndent()=false`; `extractWithChild(child)` = child is ListItemNode (`:188-220`).
- [ ] **LST-NODE-4** MODEL `splice()` wraps any non-ListItem inserted node in a new ListItemNode (`createListItemNode()`, overridable); a block element (non-list, non-inline) is replaced by a TextNode of its text content (formatting lost); a ListNode or inline node is wrapped as-is (`:196-230`).
- [ ] **LST-NODE-5** MODEL `$config` transform on every dirty ListNode: `mergeNextSiblingListIfSameType` then `updateChildrenListItemValue` (`:64-69`).
- [ ] **LST-NODE-6** VIEW `<ol|ul>`; `start` attr only when != 1; DOM expando `__lexicalListType`; `updateDOM` recreates if tag or listType changed (`:126-155`).
- [ ] **LST-NODE-7** VIEW theme classes: `list.ol|ul`, `list.checklist` when check, depth class `list.{ol,ul}Depth[(depth-1) % len]` and removes `${tag}${i}` for other indices **AMBIGUOUS** (removes literal `ol0`.. names, not the configured depth classes), `list.nested.list` added when `depth-1 > 1` (`:233-291`).
- [ ] **LST-NODE-8** VIEW `exportDOM`: same as createDOM, plus `__lexicalListType="check"` attribute for checklists (round-trips via import) (`:164-177`).
- [ ] **LST-NODE-9** BRIDGE HTML import `ol` -> number with `start` from DOM; `ul` -> check if `__lexicallisttype="check"`, class `contains-task-list` (GitHub), `data-is-checklist="1"` (Joplin), or any child with `aria-checked` (Google Docs); else bullet. Direction from DOM. Children normalized: non-ListItem children wrapped in a ListItem; a ListItem with >1 children has each ListNode child **duplicated** into an extra wrapper item pushed after it (`:298-364`). Rule variant `L/ListImportExtension.ts:39-87`.
- [ ] **LST-NODE-10** MODEL `ListSchema` accepts ListItem or List children; inline runs packaged into a synthetic ListItem (no paragraph) (`L/ListImportExtension.ts:198-207`).

##### 2.2 ListItemNode (`L/LexicalListItemNode.ts`)

- [ ] **LST-ITEM-1** MODEL type `"listitem"`; `__value` (default 1), `__checked?: boolean`; JSON `{checked: getChecked(), value}` (`:92-160,249-255`).
- [ ] **LST-ITEM-2** MODEL `getChecked()` returns `Boolean(__checked)` only when parent list is `check`, else `undefined`; `toggleChecked()` flips raw `__checked` (`:456-478`).
- [ ] **LST-ITEM-3** MODEL transform: under a non-check list, non-null checked is cleared to undefined (`:104-106`); `updateChildrenListItemValue` also clears raw `__checked` for non-check lists (`L/formatList.ts:331-333`).
- [ ] **LST-ITEM-4** MODEL orphan transform: ListItem whose parent is not a ListNode gets wrapped: a new parent (`createParentElementNode()` = bullet ListNode) inserted before it, contiguous ListItem siblings on both sides collected into it; if the old parent is not root/shadow root, the new list is lifted to the nearest root by splitting ancestors (`$shouldSplit:false`, `removeEmptyDestination`), and the emptied old parent removed (`:107-140`).
- [ ] **LST-ITEM-5** MODEL "nested list item" (`isNestedListNode`) = ListItem whose **first child** is a ListNode; such items carry no own content and are not numbered (`L/utils.ts:131-138`).
- [ ] **LST-ITEM-6** MODEL `append(...)`: element nodes for which `canMergeWith` (ListItem or Paragraph) are unwrapped (their children appended, node removed) (`:257-271`).
- [ ] **LST-ITEM-7** MODEL `replace(node, includeChildren)`: ListItem -> normal replace. Otherwise outdents self to 0, then if first in list inserts `node` before the list, if last after it, else splits the list (copy of list gets following siblings) and inserts `node` between; optionally moves children into `node` and remaps element-anchored selection points; removes self and the list if emptied (`:273-339`).
- [ ] **LST-ITEM-8** MODEL `insertAfter(node)`: ListItem -> normal; non-ListItem -> splits the list: `node` goes after the list and following siblings move into a copy of the list after `node` (`:341-369`).
- [ ] **LST-ITEM-9** MODEL `remove()`: after removal, if previous and next siblings are both nested-list items, their inner lists are merged (`mergeLists`) and the next removed (`:371-385`).
- [ ] **LST-ITEM-10** MODEL `resetOnCopyNodeFrom`: a copy (`$copyNode`) of a checked item starts unchecked (`:387-392`).
- [ ] **LST-ITEM-11** MODEL `insertNewAfter()` (Enter mid-item): inserts `$copyNode(this)` (same type, unchecked, empty) after self; caret split is done by core (`:394-403`).
- [ ] **LST-ITEM-12** MODEL `collapseAtStart(selection)` (Backspace at item start with indent 0, via core `$collapseAtStart`): children moved into a new Paragraph. If the list has only this item: nested list -> remove the list and select the parent item (unindent); top-level -> paragraph replaces the list, element-anchored points remapped. Else paragraph inserted **before the list** (regardless of item position) and the item removed (`:405-442`). **AMBIGUOUS** for non-first items the paragraph lands before the whole list.
- [ ] **LST-ITEM-13** MODEL `getIndent()` = number of ListItem ancestors (nesting depth), falling back to stored `__indent` when detached; `setIndent(n)` floors, asserts >=0, and repeatedly applies `$handleIndent`/`$handleOutdent` (`:480-513`).
- [ ] **LST-ITEM-14** MODEL `canInsertAfter`/`canReplaceWith` only ListItem; `canMergeWith` ListItem|Paragraph; `isParentRequired()=true`; `createParentElementNode()` = bullet list; `canMergeWhenEmpty()=true`; `canIndent` inherited (true) (`:516-554`).
- [ ] **LST-ITEM-15** MODEL `extractWithChild`: only for RangeSelection fully inside the item whose text length equals the item's text length (`:529-542`).
- [ ] **LST-ITEM-16** MODEL text format/style mirroring: transforms keep the ListItem's `textFormat`/`textStyle` equal to its first child TextNode's format/style; an empty item adopts the collapsed selection's format/style when the selection is on it (`L/registerList.ts:103-145`).
- [ ] **LST-ITEM-17** VIEW `<li>`, `dom.value = __value`; element `__style` applied; marker style: each CSS prop of `__textStyle` exposed as `--listitem-marker-<prop>` custom property (stale ones removed) (`:65-191`).
- [ ] **LST-ITEM-18** VIEW checklist leaf items (parent is check list and first child not a list) get `role="checkbox"`, `tabIndex=-1`, `aria-checked`; removed otherwise (`:613-636`).
- [ ] **LST-ITEM-19** VIEW theme classes, canonical order: remove checked/unchecked/nested; add `list.listitem`, `listitemChecked|listitemUnchecked` for checklists, `list.nested.listitem` when any child is a ListNode (`:557-611`). `updateDOM` never recreates (`:193-202`).
- [ ] **LST-ITEM-20** VIEW `exportDOM`: `text-align` from format, `dir`; nested-list item's children are hoisted into the previous `<li>` sibling and the wrapper removed (standard HTML nesting) (`:213-247`).
- [ ] **LST-ITEM-21** BRIDGE HTML `li` import: GitHub `.task-list-item` with child `<input type=checkbox>` and Joplin `.joplin-checkbox > .checkbox-wrapper > input` -> checked from `checked` attr; else `aria-checked` true/false/absent; format/direction from DOM; single child Paragraph with alignment lifts alignment to the item and unwraps the paragraph (Google Docs) (`:638-704`, rule variant `L/ListImportExtension.ts:95-188`).

##### 2.3 Numbering and merging (`L/formatList.ts`)

- [ ] **LST-NUM-1** MODEL `updateChildrenListItemValue(list)`: value starts at `list.start`; each ListItem child gets current value; counter increments only for non-nested items (nested-list wrappers share the next number) (`:323-339`).
- [ ] **LST-NUM-2** MODEL `mergeNextSiblingListIfSameType(list)`: adjacent next sibling ListNode of same listType is merged in (runs in ListNode transform, so adjacent same-type lists always coalesce) (`:346-354`).
- [ ] **LST-NUM-3** MODEL `mergeLists(a, b)`: if a's last item and b's first item are both nested-list items, recursively merge their inner lists first and drop b's first; then append all b children to a and remove b (`:224-244`).
- [ ] **LST-NUM-4** MODEL `UPDATE_LIST_START_COMMAND {listNodeKey, newStart}`: for number lists sets start and renumbers; returns true even for non-number lists if node is a list (`L/registerList.ts:63-78`).
- [ ] **LST-NUM-5** MODEL `$getNewListStart(list, item)` = `list.start + item.indexWithinParent` (`L/utils.ts:191-196`).

##### 2.4 Insert / remove list (`L/formatList.ts`)

- [ ] **LST-INS-1** MODEL `$insertList(type)`: Range selection anchored at root/shadow root -> select start of its first child (or create+select a paragraph) and use those nodes (`:68-86`).
- [ ] **LST-INS-2** MODEL selecting an empty ListItem (nodes empty, or only the anchor item with 0 children): if its parent is root -> anchor replaced by new list with one item copying format/indent (**AMBIGUOUS**: unreachable for ListItem anchor, since its parent is a list); if anchor is ListItem -> its parent list's children moved into a new list of `type` that replaces the old list (type change of whole list) (`:87-105`).
- [ ] **LST-INS-3** MODEL general: for each selected node: empty non-ListItem element -> `$createListOrMerge`; else walk up from leaf (or empty ListItem): reaching a ListNode -> replace that list with a new list of `type` containing its children (whole list changes type, nested lists untouched unless selected); reaching a block whose parent is root/shadow root -> `$createListOrMerge(block)` (`:108-154`).
- [ ] **LST-INS-4** MODEL `$createListOrMerge(block, type)`: new ListItem takes block's children; appended to previous sibling list of same type (and merges following same-type list), else prepended to next same-type list, else block replaced by a new list; item copies block's format type and indent (indent becomes nesting via setIndent); element-anchored selection on the target list remapped to the item; block removed (`:160-216`).
- [ ] **LST-INS-5** MODEL toggling: `$insertList` never removes; applying the same type to an existing list replaces it with an identical new list (keys change). Toggle-off is the caller's job via REMOVE_LIST_COMMAND.
- [ ] **LST-INS-6** MODEL `$removeList()`: Range only. Collect top-level lists of each selected leaf's nearest ListItem (or the anchor's top list if selecting an empty item). For each list, every non-wrapper item (`$getAllListItems`, flattening nesting in document order) becomes a Paragraph with `selection.style`/`selection.format` as text style/format, inserted in sequence after the list; points on removed items moved into the paragraph; list removed. Removes the **entire** top-level list, not just selected items (`:252-315`).
- [ ] **LST-INS-7** MODEL commands (all LOW, return true): `INSERT_UNORDERED_LIST_COMMAND` -> bullet, `INSERT_ORDERED_LIST_COMMAND` -> number, `INSERT_CHECK_LIST_COMMAND` -> check (registered by registerCheckList), `REMOVE_LIST_COMMAND` (`L/registerList.ts:50-102`, `L/checkList.ts:114-122`). Deprecated wrappers `insertList(editor,type)`/`removeList(editor)` (`L/index.ts:83-98`).

##### 2.5 Enter / Backspace

- [ ] **LST-KEY-1** MODEL `$handleListInsertParagraph(restoreNumbering)` on INSERT_PARAGRAPH (LOW, before rich-text default): only collapsed Range on an empty item (element-anchored with 0 children) or an item whose children are all whitespace-only TextNodes (`:503-534`).
- [ ] **LST-KEY-2** MODEL empty item, top-level list: new Paragraph inserted after the **top** list; nested list: copy of grandparent item inserted after the grandparent (outdent by one level). Replacement gets selection style/format and is selected. Following siblings of the empty item move into a copy of its list placed after the replacement (wrapped in a nested-list item when outdenting); new list start = 1, or `$getNewListStart` when `restoreNumbering` (`shouldPreserveNumbering`). Then `$removeHighestEmptyListParent(item)` (`:536-582`).
- [ ] **LST-KEY-3** MODEL `$removeHighestEmptyListParent(node)`: climb while node is an only child and parent is ListItem/List; remove the highest such (`L/utils.ts:161-186`).
- [ ] **LST-KEY-4** MODEL Enter in a non-empty item -> core `insertParagraph` -> `insertNewAfter` (LST-ITEM-11).
- [ ] **LST-KEY-5** MODEL Backspace at start of an item: rich-text dispatches OUTDENT when block indent >0 and caret at block start (nested item -> outdent) (`lexical-rich-text/src/index.ts:540-554,1001-1004`); at indent 0 core deleteCharacter calls `ListItemNode.collapseAtStart` (LST-ITEM-12) (`lexical/src/LexicalSelection.ts:2041-2063`).

##### 2.6 Indent / outdent (`L/formatList.ts`)

- [ ] **LST-IND-1** MODEL INDENT/OUTDENT_CONTENT reach list items via core `$handleIndentAndOutdent` (nearest non-inline block of each selected node, once each, if `canIndent()`) calling `setIndent(getIndent()±1)` (`lexical-utils/src/index.ts:695-718`); TabIndentationExtension `maxIndent` blocks indent when `newIndent >= maxIndent` (`lexical-extension/src/TabIndentationExtension.ts:100-117`).
- [ ] **LST-IND-2** MODEL `$handleIndent(item)`: no-op for nested-list wrappers. Prev and next siblings both wrappers -> append item to prev's inner list and merge next's inner list into it, removing next. Only next is wrapper -> insert item at start of next's inner list. Only prev is wrapper -> append to prev's inner list. Else -> new wrapper item (`$copyNode(item)`) containing a new list (`$copyNode(parent)`, same type/start) containing the item, placed where the item was (`:362-428`).
- [ ] **LST-IND-3** MODEL `$handleOutdent(item)`: no-op for wrappers or non-nested items (needs list > item > list ancestry). First child of inner list -> moved before the grandparent wrapper (wrapper removed if inner list empties). Last child -> moved after the wrapper (same cleanup). Middle -> previous siblings into a new wrapper+list before, next siblings into a new wrapper+list after, and the grandparent wrapper replaced by the item (`:436-492`).
- [ ] **LST-IND-4** MODEL indentation level is structural only; ListItem `__indent` is not used while attached (LST-ITEM-13). Visual indent width is theme CSS.
- [ ] **LST-IND-5** MODEL `hasStrictIndent` (`registerListStrictIndentTransform`): ListNode transform walks all items BFS; an item cannot be more than one level deeper than the deepest end of its previous sibling item: no previous-sibling ancestor chain and indent>0 -> indent 0; else if `prevDepth + 1 < depth` -> `setIndent(prevDepth)` (`L/registerList.ts:150-231`).

##### 2.7 Checklists (`L/checkList.ts`)

- [ ] **LST-CHK-1** BRIDGE click hit-area: event target must be an `<li>` whose first child is not `UL/OL`, parent DOM `__lexicalListType==='check'`; hit if clientX/zoom is within the `::before` pseudo-element width from the left edge (from the right edge when `dir=rtl`), padded by 32px for touch (`:270-341`).
- [ ] **LST-CHK-2** BRIDGE on hit (click, or `pointerup` with touch): if editable, update: focus the `<li>` (unless `disableTakeFocusOnClick`, which instead adds SKIP_SELECTION_FOCUS + SKIP_DOM_SELECTION tags) and `toggleChecked()`. Per-target 500 ms dedup between click and touch pointerup (`:73-108,343-369`).
- [ ] **LST-CHK-3** BRIDGE capture-phase `pointerdown`/`mousedown`/`touchstart` (non-passive) on the marker: `preventDefault` (caret does not move, mobile keyboard not opened); with `disableTakeFocusOnClick` also `stopPropagation` (`:218-266,377-388`).
- [ ] **LST-CHK-4** BRIDGE focused-item mode (a check `<li>` is `document.activeElement`): Space toggles checked (if editable); Escape focuses the root; ArrowUp/Down select start of previous/next leaf check item (climbing out of / descending into nested lists) and focus its `<li>` on next tick; returns false (`:137-176,390-469`).
- [ ] **LST-CHK-5** BRIDGE ArrowLeft with collapsed caret at start of a check item (element point or offset 0 on first descendant) focuses the `<li>` (enters focused-item mode) (`:177-216`).
- [ ] **LST-CHK-6** MODEL there is no `UPDATE_CHECKLIST` command in v0.45.0; toggling is only via `toggleChecked()`/`setChecked()`.

##### 2.8 Extensions (`L/LexicalListExtension.ts`)

- [ ] **LST-EXT-1** MODEL `ListExtension` (`@lexical/list/List`): nodes `[ListNode, ListItemNode]`; config `hasStrictIndent:false`, `shouldPreserveNumbering:false` (-> `restoreNumbering`); live signals re-register (`:18-56`).
- [ ] **LST-EXT-2** MODEL `CheckListExtension` (`@lexical/list/CheckList`): depends on ListExtension; config `disableTakeFocusOnClick:false` (signal, peeked per event) (`:58-76`).
- [ ] **LST-EXT-3** MODEL `ListImportExtension` (`@lexical/list/Import`): rule order TaskList item, Joplin item, list, li (`L/ListImportExtension.ts:215-238`).
- [ ] **LST-EXT-4** MODEL markdown list syntax (bullets `-*+`, `1.`, `[ ]`/`[x]`) lives in `@lexical/markdown` with Macro's 2-space indent patch (PATCH-MD-1); out of scope here.

---

#### 3. @lexical/code, code-core, code-prism, code-shiki

`@lexical/code` (`lexical-code/src/index.ts`) only re-exports code-core plus deprecated prism aliases (`normalizeCodeLang` = `normalizeCodeLanguage`, `getCodeLanguages`, `registerCodeHighlighting`, `PrismTokenizer`, ...).

##### 3.1 CodeNode (`C/CodeNode.ts`)

- [ ] **CODE-NODE-1** MODEL type `"code"`; `__language?: string` (`language || undefined`, so `""`/null -> undefined), `__theme?: string` (same normalization), `__isSyntaxHighlightSupported: boolean` (default false) (`:83-111,382-410`).
- [ ] **CODE-NODE-2** MODEL JSON `{...element, language, theme}`; **`isSyntaxHighlightSupported` is not serialized** (runtime-only, recomputed by highlighter transform); clone keeps all three (`:95-111,277-294`).
- [ ] **CODE-NODE-3** MODEL children are a **flat** sequence of `CodeHighlightNode | TabNode | LineBreakNode` (plain TextNodes transiently, until the highlighter transform replaces them); lines are delimited by LineBreakNodes (`C/FlatStructureUtils.ts`, `C/CodeIndentation.ts:99-102`).
- [ ] **CODE-NODE-4** MODEL `DEFAULT_CODE_LANGUAGE = 'javascript'`; `getDefaultCodeLanguage()` (`:58-60`).
- [ ] **CODE-NODE-5** MODEL `canIndent()=false` (block-level INDENT never applies to the code node itself) (`:370-372`).
- [ ] **CODE-NODE-6** MODEL `collapseAtStart()` (Backspace at very start): replace CodeNode with a Paragraph holding all its children (LineBreaks/Tabs kept; CodeHighlightNodes become TextNodes via CODE-HL-7 if a highlighter is registered) (`:374-380`).
- [ ] **CODE-NODE-7** MODEL `insertNewAfter(selection)` (Enter inside code): first point's node if text: collect leading indentation of its line from the line's first node: each leading TabNode -> new TabNode; leading spaces of CodeHighlightNodes -> one CodeHighlightNode of that many spaces; stop at first non-space. Split anchor text at `anchor.offset`, insert `LineBreak + indentation` after the split point; caret after last inserted indent node, else before/after the linebreak. If the point is on the CodeNode (element), insert a LineBreak at offset and select after it. Returns null (no new block) (`:297-368`). **AMBIGUOUS** uses anchor.offset to split the *first* point's node; with a backward non-collapsed selection the offsets differ (core normally removes selected text first).
- [ ] **CODE-NODE-8** MODEL exit on triple Enter (`$exitCodeNodeOnEnter`): collapsed element selection on the CodeNode at offset == childrenSize >= 2 whose last two children are LineBreaks -> remove both trailing LineBreaks, insert an empty Paragraph after the CodeNode and select it (`:478-503`). Wired to KEY_ENTER_COMMAND (LOW, preventDefault) by `CodeExtension` (`C/CodeExtension.ts:23-40`); without CodeExtension the same check runs inside `insertNewAfter` with a one-time deprecation warning (`:301-312`).
- [ ] **CODE-NODE-9** VIEW `createDOM`: `<code>` with `theme.code` class, `spellcheck=false`, `data-language` when language set, `data-highlight-language` when language set **and** syntax-highlight supported, `data-theme` when theme, element `style` applied; `updateDOM` patches these attributes in place, never recreates (`:114-183`).
- [ ] **CODE-NODE-10** VIEW `exportDOM`: same attributes but `<pre>` element (`:185-208`).
- [ ] **CODE-NODE-11** BRIDGE HTML import: `<pre>` (prio 0) -> CodeNode with `data-language`; `<code>` only when multi-line (text has `\n` or descendant `<br>`) (prio 1); `<div>` with `font-family` containing `monospace` -> CodeNode, div inside such an ancestor -> unwrapped (`node:null`); GitHub `table.js-file-line-container` -> CodeNode (prio 3), its `tr`/`td` -> no-op passthrough (`:210-476`).
- [ ] **CODE-NODE-12** BRIDGE new import rules (`CodeImportExtension`, `@lexical/code/Import`): order GitHub table, GitHub `td.js-file-line`, multiline `<code>`, `<pre>`, monospace `<div>`; VS Code paste preprocess: if any `div` with monospace font and `white-space: pre*` exists, overlay rules turn a wrapper div with `<div>`/`<br>` lines, or a run of >=2 sibling such divs/brs, into one CodeNode from raw text (`$generateNodesFromRawText`) (`C/CodeImportExtension.ts:62-403`).
- [ ] **CODE-NODE-13** MODEL `CodeExtension` (`@lexical/code`): nodes `[CodeNode, CodeHighlightNode]` + the Enter-exit handler (`C/CodeExtension.ts:23-40`).
- [ ] **CODE-NODE-14** MODEL markdown fences (```lang) are implemented in `@lexical/markdown`, not in code-core; nothing in code-core parses backticks. Note tokenizer `defaultLanguage: null` exists so a fence without info string round-trips without gaining a language (`P/CodeHighlighterPrism.ts:53-61,139-141`).

##### 3.2 CodeHighlightNode (`C/CodeHighlightNode.ts`)

- [ ] **CODE-HL-1** MODEL type `"code-highlight"`, extends TextNode; `__highlightType?: string` (`setHighlightType(t)` stores `t || undefined`) (`:37-76`).
- [ ] **CODE-HL-2** MODEL JSON = TextNode JSON + `highlightType`; **persisted in synced documents** (it is a real node type in the tree, with its own key, text, highlightType and, for Shiki, inline `style`) (`:113-132`).
- [ ] **CODE-HL-3** MODEL `canHaveFormat()=false` and `setFormat()` is a no-op (bold/italic etc. cannot apply) (`:78-137`).
- [ ] **CODE-HL-4** MODEL `isParentRequired()=true`, `createParentElementNode()` = new CodeNode (inserting a lone CodeHighlightNode outside code wraps it in a CodeNode) (`:139-145`).
- [ ] **CODE-HL-5** VIEW `<span>` (TextNode DOM) plus class `theme.codeHighlight[highlightType]`; `updateDOM` swaps the class when the resolved class changes (`:82-111,148-158`).
- [ ] **CODE-HL-6** MODEL utilities: `$getFirstCodeNodeOfLine`/`$getLastCodeNodeOfLine` walk siblings while CodeHighlight or Tab (stop at LineBreak); `$getCodeLineDirection` = first strong-direction text in the line, else parent direction; `$plainifyCodeContent(text)` -> LineBreak per `\n`, Tab per `\t`, CodeHighlightNode (no type) per non-empty part (`C/FlatStructureUtils.ts:35-104,238-256`).
- [ ] **CODE-HL-7** MODEL (highlighter registered) text transform: a TextNode/CodeHighlightNode whose parent is a CodeNode re-runs the CodeNode highlight; a CodeHighlightNode whose parent is **not** a CodeNode is replaced by a plain TextNode with the same text (`P/CodeHighlighterPrism.ts:84-100`, `S/CodeHighlighterShiki.ts:80-96`).

##### 3.3 Highlighting pipeline (Prism, `P/CodeHighlighterPrism.ts`)

- [ ] **CODE-PR-1** MODEL `registerHighlightingOnly(editor, tokenizer)`: transforms on CodeNode, TextNode and CodeHighlightNode all funnel to `$codeNodeTransform`; per-update `nodesCurrentlyHighlighting` set dedups work, cleared via `$onUpdate` (`:126-171,327-401`).
- [ ] **CODE-PR-2** MODEL language defaulting: if `language === undefined` and tokenizer `defaultLanguage !== null`, the transform **writes** `setLanguage(defaultLanguage)` onto the node (persisted) (`:139-141`).
- [ ] **CODE-PR-3** MODEL `isSyntaxHighlightSupported` set true when `Prism.languages` has the language (or the `X` of `diff-X`), else false; for an unloaded language the transform returns **without tokenizing** (Prism `loadCodeLanguage` is a no-op, so unknown languages stay as whatever children they have, e.g. raw TextNodes) (`:143-159`, `P/FacadePrism.ts:116-133`). **AMBIGUOUS** whether port should plainify instead.
- [ ] **CODE-PR-4** MODEL re-highlight: whole code text (`getTextContent()`) re-tokenized each time; `getDiffRange` finds longest equal prefix and suffix (equal = both CodeHighlight with same text+highlightType, both Tab, or both LineBreak; plain TextNodes never equal) and `splice`s only the middle (`:173-198,266-325`).
- [ ] **CODE-PR-5** MODEL `$updateAndRetainSelection`: for a Range selection, records the anchor's absolute text offset within the CodeNode (sum of previous siblings' text sizes + offset), or remembers an element anchor right after a LineBreak; after a change, re-selects the same element offset, or places a collapsed caret at the first text node whose cumulative size reaches the offset (LineBreaks count 1). Focus is not separately preserved (selection collapses) (`:203-262`). **AMBIGUOUS** non-collapsed selections collapse on re-highlight.
- [ ] **CODE-PR-6** MODEL Prism token flattening (`$mapTokensToLexicalStructure`): string tokens split on `\n`/`\t` -> LineBreak / Tab / CodeHighlight(text, inherited type); token with string content -> its `type` (or alias for `prefix` tokens); token with array content -> recurse with outer `type` as inherited type for bare strings (nested tokens use their own type), `unchanged` -> no type. Result is flat (`P/FacadePrism.ts:267-310`).
- [ ] **CODE-PR-7** MODEL `diff-<lang>` languages: tokenize with Prism `diff` grammar then re-tokenize each inserted/deleted/unchanged hunk's content with `<lang>` and re-insert prefix tokens (`prefix` typed with alias inserted/deleted/unchanged) at line starts (`P/FacadePrism.ts:110-265`).
- [ ] **CODE-PR-8** MODEL `PrismTokenizer {defaultLanguage:'javascript', tokenize(code, lang) (falls back to default grammar), $tokenize(codeNode, lang) (null lang -> plainify)}`; `Tokenizer` interface = `{defaultLanguage: string|null, tokenize, $tokenize}` (`:47-82`).
- [ ] **CODE-PR-9** MODEL bundled Prism grammars: clike, diff, javascript, markup, markdown, c, css, objectivec, sql, powershell, python, rust, swift, typescript, java, cpp (plus Prism core defaults) (`P/FacadePrism.ts:9-25`).
- [ ] **CODE-PR-10** MODEL language registry helpers: `CODE_LANGUAGE_MAP` aliases (`cpp, java, javascript->js, md->markdown, plaintext->plain, python->py, text->plain, ts->typescript`), `normalizeCodeLanguage(l) = map[l] || l`, `CODE_LANGUAGE_FRIENDLY_NAME_MAP` (17 entries), `getLanguageFriendlyName`, `getCodeLanguages()` = sorted non-function keys of `Prism.languages`, `getCodeLanguageOptions()` = friendly map entries, `getCodeThemeOptions()` = [] (Prism has no themes) (`P/FacadePrism.ts:43-108`).
- [ ] **CODE-PR-11** VIEW line-number gutter (non-headless only): mutation listener sets `data-gutter="1\n2\n..."` on the `<code>` element (one number per LineBreak + 1), skipped when child count unchanged (`:102-124,359-379`).
- [ ] **CODE-PR-12** MODEL `registerCodeHighlighting(editor, tokenizer=Prism)` asserts nodes registered, registers highlighting **and** `registerCodeIndentation(editor)` with tabSize undefined (`:409-422`). `CodePrismExtension` (`@lexical/code-prism`): config `{disabled:false, tokenizer: PrismTokenizer}`, depends on CodeExtension + CodeIndentExtension; live `disabled` toggle (`:424-461`).

##### 3.4 Shiki differences (`S/`)

- [ ] **CODE-SH-1** MODEL Shiki `Tokenizer` = `{defaultLanguage, defaultTheme, $tokenize}` (no string `tokenize`); `ShikiTokenizer.defaultTheme = 'one-light'` (`S/CodeHighlighterShiki.ts:46-78`).
- [ ] **CODE-SH-2** MODEL language defaulting uses falsy check (`!language`), theme defaulting writes `setTheme(defaultTheme)` when unset (both persisted) (`:144-154`).
- [ ] **CODE-SH-3** MODEL async loading: unloaded theme or language -> start dynamic import and skip highlighting this pass (theme only blocks when a language is set); when the language finishes loading, an `editor.update` sets `isSyntaxHighlightSupported=true` if the node still has that language (triggers re-highlight); theme load `markDirty()`s the node (`:156-189`, `S/FacadeShiki.ts:51-117`).
- [ ] **CODE-SH-4** MODEL `isCodeLanguageLoaded`: Shiki special langs (`ansi, '', plaintext, txt, text, plain`) always loaded; `diff-X` checks X; aliases count (`S/FacadeShiki.ts:38-49`).
- [ ] **CODE-SH-5** MODEL Shiki token mapping: one LineBreak between token lines; each token split on `\t` into Tab + CodeHighlightNodes **with inline `style` = stringified token color/font style** and **no highlightType**; for `diff-X` the first char of each line's first token, if one of `+ - > < space`, becomes its own CodeHighlightNode typed `inserted/deleted/inserted/deleted/unchanged` (`S/FacadeShiki.ts:163-216`).
- [ ] **CODE-SH-6** MODEL Shiki also writes CodeNode `style` = `background-color:<bg>;color:<fg>;` from the theme (persisted), and tokenizes with `codeNode.getTheme() || 'poimandres'` (`S/FacadeShiki.ts:138-161`).
- [ ] **CODE-SH-7** MODEL Shiki diff equality also compares `__style` (`S/CodeHighlighterShiki.ts:338-350`); otherwise same diff/splice/retain-selection logic as Prism.
- [ ] **CODE-SH-8** MODEL helpers: `normalizeCodeLanguage` maps alias -> bundled id; `getCodeLanguageOptions()` = all bundled `[id, name]`; `getCodeThemeOptions()` = bundled `[id, displayName]` (`S/FacadeShiki.ts:119-136`).
- [ ] **CODE-SH-9** MODEL `CodeShikiExtension` (`@lexical/code-shiki`) same shape as Prism's; legacy `CodeHighlighterShikiExtension` (`@lexical/code-shiki/legacy`) forwards a flat Tokenizer config into it (`S/CodeHighlighterShiki.ts:440-506`).

##### 3.5 Indentation and keys (`C/CodeIndentation.ts`, `registerCodeIndentation`, all LOW priority)

- [ ] **CODE-KEY-1** MODEL "selection in code" = Range selection whose anchor and focus nodes are (or are children of) the same CodeNode (`:62-79`).
- [ ] **CODE-KEY-2** MODEL `$getCodeLines(selection)`: groups selected nodes into lines split at LineBreaks, dropping empty lines; drops the last line if the selection end is exactly at its first node offset 0; returns [] if the only node is the CodeNode (`:88-126`).
- [ ] **CODE-KEY-3** BRIDGE KEY_TAB in code (preventDefault, dispatch): collapsed -> Tab: INSERT_TAB, Shift+Tab: OUTDENT_CONTENT. Non-collapsed: 0 or >=2 non-empty lines -> INDENT/OUTDENT_CONTENT; one line: selection starting before line start or ending after line end, or covering the full line -> INDENT/OUTDENT; partial within the line -> INSERT_TAB / OUTDENT (`:128-205,507-519`). Runs before TabIndentationExtension (EDITOR prio) and after table Tab (HIGH).
- [ ] **CODE-KEY-4** MODEL INSERT_TAB_COMMAND in code -> `$insertNodes([TabNode])` (replaces selected text) (`:520-531`).
- [ ] **CODE-KEY-5** MODEL INDENT_CONTENT in code: collapsed with no lines (caret at a line start / empty line) -> insert a TabNode; selection exactly one LineBreak (`"\n"`) -> replace with `Tab + LineBreak` and reselect over them; else for each selected non-empty line insert a TabNode before the line's first node (first line uses true line start even if partially selected), moving the start point onto the new tab if it was at line start (`:207-278,532-536`).
- [ ] **CODE-KEY-6** MODEL OUTDENT_CONTENT in code: collapsed at line start with no lines -> handled, no-op. Per line: if first node is a TabNode remove it; else if `tabSize` configured and first node is CodeHighlight with leading spaces, strip `min(tabSize, leading)` spaces and shift same-node anchor/focus offsets (`$outdentLeadingSpaces`) (`:279-287,537-541`, `C/FlatStructureUtils.ts:272-311`). Only one tab/indent level removed per line.
- [ ] **CODE-KEY-7** BRIDGE Alt+ArrowUp/Down (selection endpoints on CodeHighlight/Tab nodes in one code block): moves the whole lines spanned by the selection above the previous line / below the next line by relocating the line nodes and one LineBreak; no-op (still handled, preventDefault + stopPropagation) at first/last line; selection restored to same nodes/offsets (`:290-420`).
- [ ] **CODE-KEY-8** BRIDGE ArrowUp collapsed at offset 0 of the code's first child, or ArrowDown collapsed at end of the last child -> preventDefault and **handled (caret stays)**; other non-Alt cases fall to `$handleShiftLines` which escapes via `selectPrevious/selectNext` only when the CodeNode has no sibling (`:542-593,317-347`). **AMBIGUOUS**: the earlier "prevent moving out" guard makes the escape branch unreachable for those exact positions, so arrows never leave a code block at its first/last character; exit relies on CODE-NODE-8 or clicking.
- [ ] **CODE-KEY-9** BRIDGE MOVE_TO_START (Home) in code: target = first non-space character of the line (`$getStartOfCodeInLine`): if the caret is after code, jump to first non-blank; if the caret is in leading whitespace/at line start, jump to the next non-blank in the line, or line start if none; line start = after previous LineBreak (`selectNext(0,0)`) or `CodeNode.selectStart()`. MOVE_TO_END (End) -> end of the line's last CodeHighlight/Tab node. RTL lines swap start/end. Shift extends (anchor restored). Always preventDefault + stopPropagation (`:422-485`, `C/FlatStructureUtils.ts:106-228`).
- [ ] **CODE-KEY-10** MODEL `CodeIndentExtension` (`@lexical/code-indent`): config `disabled:false`, `tabSize: undefined` (when set, enables space-outdent; Tab still inserts a TabNode); depends on CodeExtension; required by both Prism and Shiki extensions; usable alone for unhighlighted code (`:607-654`).
- [ ] **CODE-KEY-11** MODEL Enter preserves indentation (CODE-NODE-7); Shift+Enter / Backspace use core behaviour (LineBreak insertion / deletion) **AMBIGUOUS** not specialised in code-core.

### 3D — Behaviour inventory D — history, clipboard, html, extension, headless, yjs, selection, utils (Lexical v0.45.0)

Paths are relative to `target/lexical-upstream/packages`. VIEW = DOM/browser-only behaviour (port as a view-layer concern or skip in headless core).

---

#### 1. @lexical/history (`lexical-history/src/index.ts`)

##### State shape
- [ ] **HIS-01** `HistoryStateEntry = {editor, editorState}` — entry records which editor (nested editors share one state) (index.ts:54)
- [ ] **HIS-02** `HistoryState = {current: null|Entry, redoStack: Entry[], undoStack: Entry[]}`; `current` is the live state, NOT on undoStack (index.ts:58)
- [ ] **HIS-03** `createEmptyHistoryState()` → `{current:null, redoStack:[], undoStack:[]}` (index.ts:593)

##### Change classification — `getChangeType(prev, next, dirtyLeaves, dirtyElements, isComposing)` (index.ts:97)
- [ ] **HIS-10** `prev === null` OR (no dirty leaves AND no dirty elements AND not composing) → `OTHER` (index.ts:104)
- [ ] **HIS-11** `editor.isComposing()` → `COMPOSING_CHARACTER` (checked before selection checks) (index.ts:114)
- [ ] **HIS-12** either selection not a RangeSelection, or either not collapsed → `OTHER` (index.ts:118)
- [ ] **HIS-13** dirty-node set = dirty leaves present in next nodeMap + dirty elements whose flag `intentionallyMarkedAsDirty===true` and are not root (getDirtyNodes) (index.ts:66)
- [ ] **HIS-14** zero dirty nodes → `OTHER` (index.ts:133)
- [ ] **HIS-15** >1 dirty nodes: `INSERT_CHARACTER_AFTER_SELECTION` iff next anchor node is a TextNode newly created (absent from prev nodeMap), text length 1, anchor offset 1, and prev anchor key resolves in next map; else `OTHER` (first char in new paragraph/list item) (index.ts:139)
- [ ] **HIS-16** exactly 1 dirty node: both prev/next must be TextNodes with same `__mode`, else `OTHER`; identical text → `OTHER` (index.ts:162)
- [ ] **HIS-17** anchors must share key and next anchor type `'text'`, else `OTHER` (index.ts:180)
- [ ] **HIS-18** textDiff +1 and prevOffset == nextOffset-1 → `INSERT_CHARACTER_AFTER_SELECTION`; −1 and prevOffset == nextOffset+1 → `DELETE_CHARACTER_BEFORE_SELECTION` (backspace); −1 and equal offsets → `DELETE_CHARACTER_AFTER_SELECTION` (forward delete); else `OTHER` (index.ts:188)

##### `isTextNodeUnchanged(key, prev, next)` (index.ts:203)
- [ ] **HIS-20** "isDeletingLine" = prev anchor+focus both element-type and next anchor+focus both text-type → never unchanged (index.ts:213)
- [ ] **HIS-21** otherwise both TextNodes with same `__parent` → unchanged iff `JSON.stringify(exportJSON())` equal (key-order sensitive) (index.ts:221)

##### Merge decision — `createMergeActionGetter(editor, delayOrSignal, dateNow)` (index.ts:238)
- [ ] **HIS-30** closure state: prevChangeTime (init = now), prevChangeType (OTHER), compositionStart{Time,ChangeType,State} (index.ts:250)
- [ ] **HIS-31** tag `composition-start` → snapshot prevChangeTime/prevChangeType/prevEditorState as composition-start values (index.ts:266)
- [ ] **HIS-32** tag `historic` → reset prevChangeType=OTHER, prevChangeTime=now, return DISCARD (undo/redo-applied states never recorded) (index.ts:274)
- [ ] **HIS-33** tag `composition-end` with stored compositionStartState → evaluate against composition-start prev state/time/type (whole IME composition = one change vs pre-composition state) (index.ts:280)
- [ ] **HIS-34** decision order: (1) `history-merge` tag and NOT `history-push` and same editor (or no current) → MERGE (index.ts:298)
- [ ] **HIS-35** (2) COMPOSING_CHARACTER → DISCARD (index.ts:306)
- [ ] **HIS-36** (3) prevEditorState null → PUSH (index.ts:310)
- [ ] **HIS-37** (4) no dirty leaves & no dirty elements: selection non-null → MERGE (selection-only change replaces current without new entry); selection null → DISCARD (index.ts:317)
- [ ] **HIS-38** (5) not push-tagged, changeType≠OTHER, ==prevChangeType, `now < prevChangeTime + delay`, same editor → MERGE (typing coalescing; delay read via `peek()` if signal) (index.ts:325)
- [ ] **HIS-39** (6) exactly one dirty leaf and `isTextNodeUnchanged` → MERGE (transform reverted change) (index.ts:339)
- [ ] **HIS-40** (7) else PUSH (index.ts:348)
- [ ] **HIS-41** after decision always update prevChangeTime/prevChangeType (except historic early-return path which already set them) (index.ts:351)
- [ ] **HIS-42** "same editor" = `current===null || current.editor===editor`; a change from a different (nested/parent) editor sharing state always breaks merge-by-delay and merge-tag (index.ts:296)

##### Applying (registerHistory update listener) (index.ts:463)
- [ ] **HIS-50** `registerHistory(editor, historyState, delay, dateNow=Date.now, onChange?, maxDepth=null)`; delay & maxDepth may be number or ReadonlySignal (index.ts:463)
- [ ] **HIS-51** skip if `current!==null && editorState === current.editorState` (reference equality) (index.ts:501)
- [ ] **HIS-52** PUSH: if redoStack non-empty → replace with `[]` (new array!) and dispatch `CAN_REDO_COMMAND(false)`; if current non-null → push shallow copy of current onto undoStack, FIFO-evict oldest via in-place `splice` to keep `length<=maxDepth`, dispatch `CAN_UNDO_COMMAND(true)` (index.ts:514)
- [ ] **HIS-53** DISCARD → return (no state change, no onChange) (index.ts:534)
- [ ] **HIS-54** PUSH and MERGE both then set `current = {editor, editorState}` and call onChange (index.ts:539)
- [ ] **HIS-55** onChange called once immediately at registration (consumers see pre-populated stacks) (index.ts:548)
- [ ] **HIS-56** **AMBIGUOUS** first edit after registration with `current===null` pushes nothing to undo (only sets current) — undo of first change is impossible until a baseline exists; intentional (initial state is the baseline set via history-merge)

##### Undo / redo / clear (index.ts:358-440)
- [ ] **HIS-60** UNDO_COMMAND (priority EDITOR, returns true): if undoStack non-empty: pop entry; push current to redoStack + `CAN_REDO(true)`; if undoStack now empty `CAN_UNDO(false)`; current=entry; onChange; `entry.editor.setEditorState(entry.editorState, {tag:'historic'})` — note applied to the entry's editor (may be a different nested editor) (index.ts:394)
- [ ] **HIS-61** REDO_COMMAND symmetric: push current to undoStack + `CAN_UNDO(true)`; pop redo; if redo empty `CAN_REDO(false)`; set state with historic tag (index.ts:358)
- [ ] **HIS-62** undo/redo with empty stack: no-op but still returns true (command handled) (index.ts:553)
- [ ] **HIS-63** CLEAR_EDITOR_COMMAND → clearHistory (stacks replaced by new arrays, current=null), returns false (lets ClearEditor run); does NOT dispatch CAN_* (index.ts:567)
- [ ] **HIS-64** CLEAR_HISTORY_COMMAND → clearHistory + dispatch CAN_REDO(false), CAN_UNDO(false); returns true (index.ts:575)
- [ ] **HIS-65** CAN_UNDO/CAN_REDO are notification commands dispatched by history; history registers no handler for them (index.ts:371)

##### HistoryExtension (index.ts:679)
- [ ] **HIS-70** name `@lexical/history/History`; config `{delay:300, createInitialHistoryState:createEmptyHistoryState, disabled: typeof window==='undefined' (disabled headless by default), maxDepth:null, now:Date.now}` (index.ts:701)
- [ ] **HIS-71** init creates writable `canUndo`/`canRedo` signals (false) (index.ts:708)
- [ ] **HIS-72** build output = namedSignals({delay, disabled, historyState: createInitialHistoryState(editor), maxDepth, now}) + {canUndo, canRedo} (readonly-typed) (index.ts:680)
- [ ] **HIS-73** register: effect — if `disabled` → canUndo=canRedo=false (batched), no listeners; else `registerHistory(editor, historyState.value, delaySignal, ()=>now.peek()(), sync, maxDepthSignal)`; re-registers when disabled or historyState signal changes (delay/maxDepth/now read lazily, not re-registering) (index.ts:713)
- [ ] **HIS-74** canUndo/canRedo derived from `undoStack.length>0`/`redoStack.length>0` on every onChange, batched (index.ts:720)

##### SharedHistoryExtension (nested editors) (index.ts:771)
- [ ] **HIS-80** name `@lexical/history/SharedHistory`; config `{disabled:false, parentEditor:null}`; depends on `configExtension(HistoryExtension,{disabled:true})` (index.ts:777)
- [ ] **HIS-81** output signals `{disabled, parentEditor: parentEditor || editor._parentEditor}` (index.ts:772)
- [ ] **HIS-82** register effect: when enabled, look up parent's HistoryExtension by name (peer); if absent → nothing; else batch-copy parent `delay`, `historyState` (same object → shared stacks), `now`, `disabled` into own HistoryExtension output signals; toggling parent disabled propagates (index.ts:787)
- [ ] **HIS-83** shared stacks + per-entry `editor` field make undo restore whichever editor produced the entry (HIS-60)

---

#### 2. @lexical/clipboard (`lexical-clipboard/src/`)

##### Exports (index.ts:9-41)
- [ ] **CLP-00** exports: caretFromPoint, $exportMimeTypeFromSelection, $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $getClipboardDataFromSelection, $getHtmlContent, $getLexicalContent, $handlePlainTextDrop, $handleRichTextDrop, $insertDataTransferForPlainText, $insertDataTransferForRichText, $insertGeneratedNodes, $writeDragSourceToDataTransfer, copyToClipboard, GetClipboardDataExtension, setLexicalClipboardDataTransfer, ClipboardDOMImportExtension, ClipboardImportExtension, DEFAULT_IMPORT_MIME_TYPE, DEFAULT_IMPORT_MIME_TYPE_PRIORITY + types (index.ts:9)

##### Data formats
- [ ] **CLP-01** `LexicalClipboardData = {'text/plain': string (required), 'text/html'?, 'application/x-lexical-editor'?, [mime]: string|undefined}` (clipboard.ts:56)
- [ ] **CLP-02** lexical JSON envelope: `{namespace: editor._config.namespace, nodes: SerializedNode[]}` stringified (clipboard.ts:563)

##### Export side
- [ ] **CLP-10** `$getHtmlContent(editor, sel=$getSelection())`: null selection → invariant; collapsed RangeSelection or `getNodes().length===0` → `''`; else `$generateHtmlFromNodes(editor, sel)` (clipboard.ts:73)
- [ ] **CLP-11** `$getLexicalContent(editor, sel)`: same guards but returns `null`; else JSON.stringify($generateJSONFromSelectedNodes) (clipboard.ts:102)
- [ ] **CLP-12** `$generateJSONFromSelectedNodes(editor, selection|null)`: walk root's top-level children with `$appendNodesToJSON`; null selection = whole document (clipboard.ts:547)
- [ ] **CLP-13** `$appendNodesToJSON`: shouldInclude = `node.isSelected(sel)` (true if sel null); shouldExclude = element `excludeFromCopy('html')` (note 'html' even for JSON); text nodes sliced to selection via `$sliceSelectedTextNodeContent(sel, node, 'clone')` before export (clipboard.ts:483)
- [ ] **CLP-14** zero-length TextNode (after slicing) → not included (clipboard.ts:501)
- [ ] **CLP-15** children recursed into serializedNode.children; unselected element becomes included if a child was included AND `currentNode.extractWithChild(child, sel, 'clone')` (clipboard.ts:508)
- [ ] **CLP-16** included & not excluded → push serialized node (with children); else splice its serialized children into the parent target array (hoist) (clipboard.ts:527)
- [ ] **CLP-17** `exportNodeToJSON` invariants: `exportJSON().type === klass.getType()` ("does not implement .exportJSON()"); elements must have `children` array (clipboard.ts:456)
- [ ] **CLP-18** `GetClipboardDataExtension` (name `@lexical/clipboard/GetClipboardData`): config `$exportMimeType: {[mime]: ExportMimeTypeFunction[]}`; default: lexical→$getLexicalContent, html→$getHtmlContent, plain→`sel.getTextContent()`; each falls to `next()` if sel null (clipboard.ts:810)
- [ ] **CLP-19** `ExportMimeTypeFunction(selection, next) => string|null`; stack called from highest index down; `next()` past bottom → null (clipboard.ts:836)
- [ ] **CLP-20** GetClipboardData mergeConfig: per-mime `[...prev, ...new]` (later registered runs first) (clipboard.ts:933)
- [ ] **CLP-21** `$getClipboardDataFromSelection(sel=$getSelection())`: uses extension output if editor built with it else defaults; result starts `{'text/plain':''}`, every mime whose stack returns non-null is set (clipboard.ts:716,820)
- [ ] **CLP-22** `$exportMimeTypeFromSelection(mime, sel)` runs a single mime stack (clipboard.ts:866)
- [ ] **CLP-23** `setLexicalClipboardDataTransfer(dt, data)`: for 'text/html' & 'application/x-lexical-editor' missing in data → `setData(k,'')` (clears stale); then set all defined entries (clipboard.ts:732)
- [ ] **CLP-24** VIEW `copyToClipboard(editor, event|null, data?)` async: re-entrancy guard — if a fallback copy is pending (module-level timeout) → false (clipboard.ts:601)
- [ ] **CLP-25** VIEW with event: inside `editor.update` resolve `$copyToClipboardEvent` (clipboard.ts:611)
- [ ] **CLP-26** VIEW without event (execCommand fallback): append hidden `<span style="position:fixed;top:-1000px">#</span>` to root, select it, register COPY_COMMAND at CRITICAL priority that, on a real ClipboardEvent (objectKlassEquals), unregisters, clears timeout, resolves $copyToClipboardEvent; 50ms timeout resolves false; `document.execCommand('copy')`; remove span (clipboard.ts:619)
- [ ] **CLP-27** VIEW `$copyToClipboardEvent`: if no data — collapsed/no selection → false; DOM selection anchor/focus outside editor → false; data = $getClipboardDataFromSelection; `preventDefault`; null clipboardData → false; else setLexicalClipboardDataTransfer → true (clipboard.ts:666)

##### Import side
- [ ] **CLP-30** `$generateNodesFromSerializedNodes(arr)` = map `$parseSerializedNode` (fresh keys) (clipboard.ts:577)
- [ ] **CLP-31** `$insertGeneratedNodes(editor, nodes, sel)`: dispatch `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND({nodes, selection})`; if unhandled → `selection.insertNodes(nodes)` then `$updateSelectionOnInsert` (tables/code hook this command) (clipboard.ts:395)
- [ ] **CLP-32** `$updateSelectionOnInsert`: collapsed RangeSelection only; find TextNode at anchor ('previous' caret: text point origin, else scan backwards stopping at non-inline element); copy its format & style onto selection (mark dirty) if different (clipboard.ts:412)
- [ ] **CLP-33** `$insertDataTransferForPlainText(dt, sel)`: text = `text/plain` || `text/uri-list`; `sel.insertRawText(text)` (clipboard.ts:129)
- [ ] **CLP-34** `$insertDataTransferForRichText(dt, sel, _editor)` → `$getImportOutput().$insertDataTransfer(dt, sel)` (editor arg ignored) (clipboard.ts:151)
- [ ] **CLP-35** ClipboardImportExtension (name `@lexical/clipboard/Import`, experimental): config `{$importMimeType: {mime: ImportMimeTypeFunction[]}, priority: {mime: number}}` (ClipboardImportExtension.ts:124,442)
- [ ] **CLP-36** `ImportMimeTypeFunction(data, selection, $next, dataTransfer) => boolean`; highest index first, `$next()` past bottom → false (ClipboardImportExtension.ts:65,291)
- [ ] **CLP-37** default priority: lexical 0, html 10, plain 20, uri-list 30; unweighted mimes sort after all weighted, lexicographically (ClipboardImportExtension.ts:158,313)
- [ ] **CLP-38** `$runImport`: for each mime in order: `data=dt.getData(mime)`; skip empty; **skip text/html if identical to text/plain** (iOS Safari autocorrect heuristic); first stack returning true wins → true; none → false (ClipboardImportExtension.ts:333)
- [ ] **CLP-39** default lexical importer: JSON.parse; accept iff `payload.namespace === editor._config.namespace` and `nodes` array → generate + $insertGeneratedNodes → true; parse error → console.error; fallthrough `$next()` (→ false → next mime) (ClipboardImportExtension.ts:179)
- [ ] **CLP-40** default html importer: DOMParser (wrapped in TrustedTypes policy 'lexical' if available) → legacy `$generateNodesFromDOM` → insert → true; throw → console.error + $next (ClipboardImportExtension.ts:209,165)
- [ ] **CLP-41** default plain importer: non-Range selection → `insertRawText`; Range → `tokenizeRawText`: `\n`/`\r\n` → `insertParagraph()`, `\t` → insert TabNode, text → `insertText` (each against current `$getSelection()`) (ClipboardImportExtension.ts:234; lexical/src/LexicalSelection.ts:3317)
- [ ] **CLP-42** text/uri-list uses plain importer (ClipboardImportExtension.ts:267)
- [ ] **CLP-43** mergeConfig: per-mime stacks concatenated `[...prev,...new]`; priority spread-merged (later overrides) (ClipboardImportExtension.ts:453)
- [ ] **CLP-44** no ClipboardImportExtension → static default output used (ClipboardImportExtension.ts:364,386)
- [ ] **CLP-45** ClipboardDOMImportExtension (`@lexical/clipboard/DOMImport`): stacks a text/html handler routing through `$generateNodesFromDOMViaExtension` with context ImportSource='paste', ImportSourceDataTransfer=dt (ClipboardImportExtension.ts:511)
- [ ] **CLP-46** **AMBIGUOUS** "multi-line plain text into code/table" is not in this package: plain text → paragraphs via insertParagraph; code/table rely on their own handlers / SELECTION_INSERT_CLIPBOARD_NODES_COMMAND (lexical-table/src/LexicalTablePluginHelpers.ts:421)

##### Drag & drop
- [ ] **CLP-50** `$writeDragSourceToDataTransfer(dt, editor)`: sets `application/x-lexical-drag` = JSON `{editorKey}` (clipboard.ts:181)
- [ ] **CLP-51** `$doDrop`: no dataTransfer or no valid drag marker → false (non-lexical drops left to browser) (clipboard.ts:260)
- [ ] **CLP-52** VIEW drop point: `caretFromPoint(clientX, clientY)` (caretRangeFromPoint / caretPositionFromPoint) → nearest lexical node → text point caret / child caret at offset / after decorator (clipboard.ts:224; caretFromPoint.ts:10)
- [ ] **CLP-53** split at drop caret (`$splitAtPointCaretNext`) to get stable caret; null → false (clipboard.ts:290)
- [ ] **CLP-54** same-editor drag: requires non-collapsed RangeSelection else false; drop strictly inside selection → preventDefault, true (no-op); else `removeText()` of current selection first (move semantics) (clipboard.ts:298)
- [ ] **CLP-55** drop caret detached after removal → preventDefault, true (clipboard.ts:320)
- [ ] **CLP-56** insert via collapsed selection at stable caret + rich/plain inserter (clipboard.ts:325)
- [ ] **CLP-57** VIEW cross-editor drag: find source root `[data-lexical-editor="true"]` with matching `__lexicalEditor.getKey()` and dispatch `beforeinput{inputType:'deleteByDrag'}` on it (clipboard.ts:330)
- [ ] **CLP-58** `$handleRichTextDrop` / `$handlePlainTextDrop` wrappers (clipboard.ts:364,376)

---

#### 3. @lexical/html (`lexical-html/src/`)

##### Exports (83, index.ts:50-135)
- [ ] **HTML-00** values: contextUpdater, contextValue, domOverride, DOMRenderExtension, $distributeInlineWrapper, $generateNodesFromDOMViaExtension, $getImportContextValue, $inlineStylesFromStyleSheets, $isBlockLevel, $withImportContext, BlockSchema, CoreImportExtension, CoreImportRules, createImportState, defaultIsInline, defaultPreservesWhitespace, defineImportRule, defineOverlayRules, DOMImportExtension, HorizontalRuleImportExtension, HorizontalRuleImportRules, ImportOverlays, ImportSource, ImportSourceDataTransfer, ImportTextFormat, ImportTextStyle, ImportWhitespaceConfig, InlineSchema, isElementOfTag, NestedBlockSchema, parseSelector, RootSchema, sel, $getRenderContextValue, $getSessionDOMRenderConfig, $setRenderContextValue, $updateRenderContextValue, $withRenderContext, createRenderState, RenderContextExport, RenderContextRoot, $generateNodesFromDOM, $generateDOMFromNodes, $generateDOMFromRoot, $generateHtmlFromNodes; plus ~38 types (index.ts:50)

##### Legacy import — `$generateNodesFromDOM(editor, dom)` (index.ts:144)
- [ ] **HTML-01** first run `$inlineStylesFromStyleSheetsDOM(dom)` (Document only) (index.ts:148)
- [ ] **HTML-02** iterate `dom.body.childNodes` for Document else `dom.childNodes`; skip STYLE/SCRIPT (IGNORE_TAGS) (index.ts:137,150)
- [ ] **HTML-03** after walk `$unwrapArtificialNodes` (index.ts:170)
- [ ] **HTML-04** conversion cache `editor._htmlConversions: Map<lowercase nodeName, fn[]>` built at createEditor from each registered klass `importDOM()` (deduped per importDOM fn identity) then `html.import` map appended last (lexical/src/LexicalEditor.ts:675,898)
- [ ] **HTML-05** `getConversionFunction`: call each `(domNode)=>DOMConversion|null`; pick highest `priority` (0-4, default 0); ties → LAST registered wins (`<=`) so app/html.import overrides beat core (index.ts:342)
- [ ] **HTML-06** `$createNodesFromDOM`: ignore STYLE/SCRIPT anywhere; conversion output `{node: LexicalNode|LexicalNode[]|null, after?, forChild?}`; when array, the LAST node is "current" (index.ts:370)
- [ ] **HTML-07** apply every ancestor `forChild(currentNode, parentLexicalNode)` in insertion order (Map keyed by ancestor nodeName — same-tag nested ancestors overwrite!); a forChild returning null drops the node (index.ts:399)
- [ ] **HTML-08** **AMBIGUOUS** forChildMap keyed by `node.nodeName` means nested `<span><span>` replaces the outer span's forChild rather than composing (index.ts:420)
- [ ] **HTML-09** children always recursed (even when no conversion) with a copy of forChildMap; `after(children)` post-processes child lexical nodes (index.ts:426,449)
- [ ] **HTML-10** hasBlockAncestor for children: false if current is root/shadow-root, else true if current is block element or inherited (index.ts:429)
- [ ] **HTML-11** block DOM node (BLOCK_TAG_RE, unless inline display): wrap continuous inline children — in a ParagraphNode if no block lexical ancestor, else in ArtificialNode (index.ts:453)
- [ ] **HTML-12** `wrapContinuousInlines`: block lexical children get DOM `style.textAlign` as format if they have none; each maximal inline run → wrapper with `setFormat(textAlign)` (index.ts:493)
- [ ] **HTML-13** unconverted DOM node: hoist children; if none and it is a block DOM node between two inline siblings → emit LineBreakNode (index.ts:469,548)
- [ ] **HTML-14** converted ElementNode: append children; non-element converted nodes drop children (index.ts:483)
- [ ] **HTML-15** `$unwrapArtificialNodes`: first insert LineBreak after each artificial node whose next sibling is artificial; then splice each artificial node's children in its place (index.ts:527)
- [ ] **HTML-16** `isBlockDomNode`: element with `display:inline*` → false, else tag in {address,article,aside,blockquote,canvas,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1-h6,header,hr,li,main,nav,noscript,ol,p,pre,section,table,td,tfoot,ul,video} (lexical/src/LexicalUtils.ts:1983)
- [ ] **HTML-17** `isInlineDomNode`: `display:inline*` → true else tag in {a,abbr,acronym,b,cite,code,del,em,i,ins,kbd,label,mark,output,q,ruby,s,samp,span,strong,sub,sup,time,u,tt,var,#text} (lexical/src/LexicalUtils.ts:1958)
- [ ] **HTML-18** ArtificialNode__DO_NOT_USE type 'artificial', always registered by createEditor (lexical/src/nodes/ArtificialNode.ts:14)

##### Core TextNode importDOM (legacy; lives in lexical core)
- [ ] **HTML-20** registered: #text, b, code, em, i, mark, s, span, strong, sub, sup, u all priority 0 (lexical/src/nodes/LexicalTextNode.ts:591)
- [ ] **HTML-21** tag→format: code→code, em/i→italic, mark→highlight, s→strikethrough, strong→bold, sub→subscript, sup→superscript, u→underline; converted as `node:null` + forChild applying format (lexical/src/nodes/LexicalTextNode.ts:1358)
- [ ] **HTML-22** `<b>`: Google Docs wrapper detection — `style.font-weight:normal` → no bold, else bold; still applies style-derived formats (lexical/src/nodes/LexicalTextNode.ts:1207)
- [ ] **HTML-23** `<span>`: forChild from inline styles only (lexical/src/nodes/LexicalTextNode.ts:1196)
- [ ] **HTML-24** style→format (additive only, toggles if not set): font-weight `700`|`bold`→bold; text-decoration contains `line-through`→strikethrough, `underline`→underline; font-style `italic`→italic; vertical-align `sub`/`super`→subscript/superscript (lexical/src/nodes/LexicalTextNode.ts:1403)
- [ ] **HTML-25** **AMBIGUOUS** legacy path never clears inherited format (`font-weight:normal` inside `<strong>` stays bold; `<sub><sup>` gets both) — fixed only in new pipeline (HIMP-24)
- [ ] **HTML-26** text inside preformatted ancestor (`<pre>` or `white-space: pre*`, cached per-parent WeakMap): no collapsing; split on `\r?\n`→LineBreak, `\t`→Tab (lexical/src/nodes/LexicalTextNode.ts:1225,1269)
- [ ] **HTML-27** non-pre: strip `\r`, collapse `[ \t\n]+` → single space; empty → null (lexical/src/nodes/LexicalTextNode.ts:1287)
- [ ] **HTML-28** leading space removed if start of line (no previous inline text on same line) or previous inline text ends in whitespace (lexical/src/nodes/LexicalTextNode.ts:1291)
- [ ] **HTML-29** trailing space removed if no following inline text with non-whitespace content on same line (lexical/src/nodes/LexicalTextNode.ts:1311)
- [ ] **HTML-30** `findTextInLine`: walk siblings/parents; stops at element with non-inline display (or no display and not inline tag) or `<br>`; descends to first/last leaf (lexical/src/nodes/LexicalTextNode.ts:1333)
- [ ] **HTML-31** **AMBIGUOUS** `<meta>`, `<head>`, comments: no IGNORE; comments have no conversion and no children → vanish; `<meta>` in body hoisted (empty). Word/Docs-specific beyond `<b id=docs-internal-guid>` font-weight check: none in core

##### Export — `$generateHtmlFromNodes(editor, sel=null)` (index.ts:241)
- [ ] **HTML-40** requires global document/window else invariant (use JSDom or `@lexical/headless/dom` withDOM) (index.ts:245)
- [ ] **HTML-41** = `$generateDOMFromNodes(div, sel, editor).innerHTML`; must be called in active editor scope (editor.read/update) (index.ts:254)
- [ ] **HTML-42** `$generateDOMFromNodes(container, sel=null, editor)`: runs in render context `RenderContextExport=true`; uses session DOM config; appends each top-level root child (root itself excluded) (index.ts:180)
- [ ] **HTML-43** `$generateDOMFromRoot(container, root=$getRoot())`: context Export+Root=true; includes the root node itself (DOMRenderExtension supplies root export `<div role="textbox">`) (index.ts:211; DOMRenderExtension.ts:59)
- [ ] **HTML-44** `$appendNodesToHTML`: shouldInclude=`$shouldInclude` (default isSelected or true), shouldExclude=`$shouldExclude` (default element.excludeFromCopy('html')); text sliced to selection (clone) before export (index.ts:258)
- [ ] **HTML-45** `$exportDOM(target)` → `{element, after?, append?, $getChildNodes?}`; default uses `html.export` map override for the klass, else `node.exportDOM(editor)`; null element → return false (skip subtree) (index.ts:276; lexical/src/LexicalEditor.ts:751)
- [ ] **HTML-46** children = `$getChildNodes()` if provided else element children; recursed into a fragment; unselected parent included if a child included and `$extractWithChild(node, child, sel, 'html')` (index.ts:284)
- [ ] **HTML-47** included: append fragment via `append(fragment)` hook or `element.append`, only if element is HTMLElement/DocumentFragment; append element to parent; then `after.call(target, element)` → if returns node: replaceChildren (fragment) or replaceWith (index.ts:315)
- [ ] **HTML-48** not included: children fragment hoisted into parent (index.ts:335)
- [ ] **HTML-49** html config: `createEditor({html:{export: Map<Klass, (editor,node)=>DOMExportOutput>, import: DOMConversionMap}})`; export override stored per registered node (lexical/src/LexicalEditor.ts:255,875)
- [ ] **HTML-50** dev warning: custom exportDOM without importDOM (lexical/src/LexicalEditor.ts:862)

##### Context records (ContextRecord.ts) — shared by render & import
- [ ] **HTML-60** context = prototype-chained plain object keyed by StateConfig.key; reads fall through parent; `getContextValue` returns default when key absent (ContextRecord.ts:41)
- [ ] **HTML-61** `contextValue(cfg, v)` → pair; `contextUpdater(cfg, prev=>next)` → updater resolved against current layer (ContextRecord.ts:159,170,107)
- [ ] **HTML-62** `contextFromPairs`: skips pairs equal to inherited value (no new layer); first differing pair creates `Object.create(parent)` child; never mutates parent (ContextRecord.ts:125)
- [ ] **HTML-63** active context is module-global `{editor, [sym]: record}`, only valid for matching editor; `$withContext` restores previous on exit (ContextRecord.ts:19,182,203)
- [ ] **HTML-64** `createContextState(tag, name, default, isEqual)` = createState(Symbol(name)) tagged with phantom symbol (render vs import separation) (ContextRecord.ts:233)

##### Render context & DOMRenderExtension
- [ ] **HREN-01** `createRenderState(name, default, isEqual?)`; V must not be a function (RenderContext.ts:36)
- [ ] **HREN-02** built-ins `RenderContextRoot` (bool), `RenderContextExport` (bool, true during $generate*) (RenderContext.ts:53,59)
- [ ] **HREN-03** `$getRenderContextValue(cfg, editor)` reads active session record else extension `defaults` (editor context) (RenderContext.ts:84)
- [ ] **HREN-04** `$withRenderContext(pairs, editor)(fn)` scoped values (RenderContext.ts:162)
- [ ] **HREN-05** `$setRenderContextValue` / `$updateRenderContextValue`: persist on editor context via runtime; no-op without DOMRenderExtension (RenderContext.ts:110,127)
- [ ] **HREN-06** `$getSessionDOMRenderConfig(editor)` → runtime session config or resident `editor._config.dom` (RenderContext.ts:149)
- [ ] **HREN-07** DOMRenderExtension (`@lexical/html/DOM`): config `{overrides: DOMRenderMatch[], contextDefaults: pairs[]}`, both concat-merged (DOMRenderExtension.ts:38,86)
- [ ] **HREN-08** init: capture editorConfig `{dom, nodes}`, build editor context from contextDefaults, filter overrides by `disabledForEditor`, overwrite `editorConfig.dom` with compiled config (DOMRenderExtension.ts:72)
- [ ] **HREN-09** build output `{defaults: editorContext, runtime}` (DOMRenderExtension.ts:44)
- [ ] **HREN-10** `domOverride(nodes '*'|NodeMatch[], config, options?)` → `{...config, ...options, nodes}` (domOverride.ts:30)
- [ ] **HREN-11** DOMRenderMatch hooks: `$createDOM, $updateDOM, $decorateDOM, $getDOMSlot, $exportDOM, $shouldInclude, $shouldExclude, $extractWithChild` each receiving `$next` + editor; plus `disabledForEditor(reader)`, `disabledForSession(reader)` (types.ts:257-457)
- [ ] **HREN-12** NodeMatch = node class (matches instanceof incl. subclasses via type tree) or predicate (types.ts:239; compileDOMRenderConfigOverrides.ts:73)
- [ ] **HREN-13** override ordering: class overrides sorted by inheritance depth (base first), then predicate overrides, then wildcard; multi-node overrides split per node; later in list wraps earlier (outermost) (compileDOMRenderConfigOverrides.ts:321)
- [ ] **HREN-14** class-match compiles into per-type dispatch tables using type tree (klass + all registered subclasses); unregistered class → invariant (compileDOMRenderConfigOverrides.ts:33,77)
- [ ] **HREN-15** middleware semantics: each override `(node,...args,$next,editor)`; `$next()` calls the accumulated lower chain; `$decorateDOM` is sequenced (all run, no $next) (compileDOMRenderConfigOverrides.ts:174,227,392)
- [ ] **HREN-16** base chain = `{...DEFAULT_EDITOR_DOM_CONFIG, ...editorConfig.dom}` (compileDOMRenderConfigOverrides.ts:397)
- [ ] **HREN-17** runtime.setContextValue: recompute installed set; if unchanged → done; else recompile resident config; if any toggled override has $createDOM/$getDOMSlot/$decorateDOM → transient $updateDOM returning true for matching nodes + `editor.update($fullReconcile, {discrete:true})` to recreate DOM (DOMRenderRuntime.ts:190)
- [ ] **HREN-18** getSessionConfig: if any override has disabledForSession, evaluate against active session context; memoize compiled config by disabled-index key (DOMRenderRuntime.ts:234)
- [ ] **HREN-19** DEFAULT_EDITOR_DOM_CONFIG: $createDOM→node.createDOM; $decorateDOM no-op; $exportDOM via html.export or node.exportDOM; $extractWithChild→element.extractWithChild; $getDOMSlot→node.getDOMSlot; $shouldExclude→element excludeFromCopy('html'); $shouldInclude→isSelected or true; $updateDOM→node.updateDOM (lexical/src/LexicalEditor.ts:748)

##### New import pipeline — DOMImportExtension (`import/`)
- [ ] **HIMP-01** DOMImportExtension (`@lexical/html/DOMImport`): config `{rules: (DOMImportRule|CompiledOverlayRules)[], contextDefaults, preprocess}`; default rules `[DefaultHoistRule]`, preprocess `[$inlineStylesFromStyleSheets]` (DOMImportExtension.ts:36,176)
- [ ] **HIMP-02** mergeConfig: `rules = [...partial, ...existing]` (later merged = higher priority); contextDefaults & preprocess appended (DOMImportExtension.ts:181)
- [ ] **HIMP-03** build: flatten overlays, compile dispatch; output `{$generateNodesFromDOM(dom, {context?, preprocess?}), defaults}` (DOMImportExtension.ts:129)
- [ ] **HIMP-04** per call: session record = fresh child of editor defaults (+ per-call context); session writes never leak (DOMImportExtension.ts:145)
- [ ] **HIMP-05** preprocess stack = config + per-call; top (last) runs first, `$next()` defers down; mutate DOM in place (DOMImportExtension.ts:78,161)
- [ ] **HIMP-06** `$generateNodesFromDOMViaExtension(dom, opts)` → throws if editor not built with DOMImportExtension (DOMImportExtension.ts:213)
- [ ] **HIMP-07** `$runImport`: overlays from `ImportOverlays` session slot primed; root parent = body or dom; children imported with `RootSchema` (runImport.ts:227)
- [ ] **HIMP-08** dispatch candidates: overlays top-of-stack first, then main dispatcher; rules within a group in registration (priority) order; predicate must match; `$next()` continues to next matching rule across groups; exhaustion → hoist children (runImport.ts:136,158,205)
- [ ] **HIMP-09** rule throw → dev console.error naming rule, rethrow (runImport.ts:179)
- [ ] **HIMP-10** `ctx` = `{$importChildren(parent, opts), $importOne(node, opts), captures, get(cfg), session}` (runImport.ts:53)
- [ ] **HIMP-11** `$importChildren` opts: `rules` (overlay pushed for subtree), `context` pairs, `$onChild` (map/drop each child), `$after` (whole list), `schema` (runImport.ts:70,91)
- [ ] **HIMP-12** compileImportRules: buckets by kind text/comment/element; element by uppercase tag, wildcards interleaved into each tag bucket by index; element with no tag bucket → wildcard list; other node types → none (compileImportRules.ts:69,162)
- [ ] **HIMP-13** default rule name `tags@index` / `#text@i` / `*@i`; dev warn on duplicate names (compileImportRules.ts:82,140)
- [ ] **HIMP-14** `defineImportRule({name?, match, $import(ctx, node, $next)})` identity (defineImportRule.ts:29)
- [ ] **HIMP-15** `defineOverlayRules(entries)` → `{__type:'CompiledOverlayRules', dispatch, rules}`; earlier entries higher priority; nested overlays inlined (defineOverlayRules.ts:96)
- [ ] **HIMP-16** DefaultHoistRule: `sel.any()` → `$importChildren(el)` (lowest priority) (DOMImportExtension.ts:105)

##### Selectors (`sel`, sel.ts / parseCss.ts)
- [ ] **HIMP-20** `sel.tag(...tags)` (≥1, uppercased), `sel.any()`, `sel.text()`, `sel.comment()`, `sel.css(str)` (index.ts:18; sel.ts:264)
- [ ] **HIMP-21** builder refinements: `.attr(name, true|string|RegExp, {capture})`, `.classAll(...)` (empty → always true), `.classAny(...)` (empty → false), `.styleAny(prop, string|RegExp, {capture})` (inline style getPropertyValue); regex match stored into `captures[name]` (sel.ts:81-233)
- [ ] **HIMP-22** CSS subset: tag, `*`, `.class`, `#id`, `[attr]`, `[attr=v]`/quoted; comma lists (union tags, OR predicate); anything else → invariant with column (parseCss.ts:160)
- [ ] **HIMP-23** **AMBIGUOUS** `sel.css('*, p')`: tags union = {P} so wildcard group only dispatched for `<p>` (parseCss.ts:193)
- [ ] **HIMP-23b** `isElementOfTag(node, tag)` cross-frame safe nodeName check (sel.ts:309)

##### Core import rules (CoreImportRules / CoreImportExtension)
- [ ] **HIMP-24** InlineFormatRule (b,strong,em,i,code,mark,s,sub,sup,u,span): effective style = tag default style merged with element inline style (element wins); compute set/clear masks: weight 700/bold set bold, normal/400 clear; italic/normal; decoration underline/line-through set, `none` clears both; vertical-align sub/super set+clear other, baseline clears both; code/mark set-only; propagate via ImportTextFormat context (coreImportRules.ts:93-251)
- [ ] **HIMP-25** TextRule: inside preserve-whitespace ancestor → `$generateNodesFromRawText` (\n→LineBreak, \t→Tab) each with format+style; else neighbor-aware collapse (same rules as HTML-27..30 using `ImportWhitespaceConfig.isInline`); apply format bits and ImportTextStyle (minus format-owned props font-weight/style/decoration/vertical-align) (coreImportRules.ts:401,307,369)
- [ ] **HIMP-26** **AMBIGUOUS** no core rule ever writes ImportTextStyle (color/font-size from span not imported unless app rule does) (ImportContext.ts:146)
- [ ] **HIMP-27** IgnoreScriptStyleRule: `<script>`,`<style>` → [] (coreImportRules.ts:433)
- [ ] **HIMP-28** LineBreakRule `<br>` → LineBreakNode (coreImportRules.ts:439)
- [ ] **HIMP-29** ParagraphRule `<p>`: format from DOM (text-align), indent from DOM, legacy `align` attr fallback (center,end,justify,left,right,start), direction from DOM; children imported with no schema (coreImportRules.ts:449)
- [ ] **HIMP-30** CoreImportRules order: ignore, p, #text, br, inline-format; CoreImportExtension = configExtension(DOMImportExtension,{rules}) (coreImportRules.ts:479; CoreImportExtension.ts:23)
- [ ] **HIMP-31** HorizontalRuleImportExtension: `<hr>` → HorizontalRuleNode; depends on Core + HorizontalRuleExtension (HorizontalRuleImportExtension.ts:20,46)

##### Import context states (ImportContext.ts)
- [ ] **HIMP-40** `createImportState(name, default, isEqual?)` default evaluated once, shared → must be immutable (ImportContext.ts:54)
- [ ] **HIMP-41** `ImportSource` 'paste'|'unknown' (default unknown); `ImportSourceDataTransfer` (null); `ImportTextFormat` (0); `ImportTextStyle` ({}); `ImportWhitespaceConfig` ({isInline: defaultIsInline, preservesWhitespace: defaultPreservesWhitespace}); `ImportOverlays` ([]) (ImportContext.ts:84-270)
- [ ] **HIMP-42** `defaultPreservesWhitespace`: PRE or style white-space starts with 'pre' (ImportContext.ts:197)
- [ ] **HIMP-43** `defaultIsInline`: text → true; non-element → false; explicit display → startsWith inline; block tag → false; else isInlineDomNode (ImportContext.ts:216)
- [ ] **HIMP-44** ImportSession `{get,set,update,has(own key)}` on the session record (ImportContext.ts:281)
- [ ] **HIMP-45** `$getImportContextValue(cfg)`, `$withImportContext(pairs)(fn)` (ImportContext.ts:320,333)

##### Schemas (schemas.ts)
- [ ] **HIMP-50** `$isBlockLevel` = block element or non-inline decorator (schemas.ts:31)
- [ ] **HIMP-51** `$applySchema`: partition into accepted / maximal rejected runs; rejected run → `$packageRun` (non-empty result used) else `onReject` 'hoist' passes through, default 'drop' discards; then `$finalize` (schemas.ts:107)
- [ ] **HIMP-52** BlockSchema/RootSchema: accept block-level; inline runs → new paragraph with DOM parent's valid text-align (schemas.ts:161,183,232)
- [ ] **HIMP-53** InlineSchema: accept non-block; blocks dropped (schemas.ts:196)
- [ ] **HIMP-54** NestedBlockSchema: accept blocks; inline runs passed through unchanged (ArtificialNode replacement) (schemas.ts:211)
- [ ] **HIMP-55** `$distributeInlineWrapper(children, $makeWrapper)`: inline runs wrapped in fresh wrapper; block children kept at top level with wrapper recursively distributed into their children (block-in-inline split, e.g. `<a><h1>`) (schemas.ts:64)

##### Stylesheet inlining (inlineStylesFromStyleSheets.ts)
- [ ] **HIMP-60** Document only and only if a `<style>` exists; for each CSSStyleRule in `doc.styleSheets` (inaccessible sheets/invalid selectors skipped) apply props to matching elements unless the element originally had that inline prop; keep priority (Excel class styles) (inlineStylesFromStyleSheets.ts:40)

---

#### 4. Extension system

##### Core definitions (`lexical/src/extension-core/`)
- [ ] **EXT-01** `defineExtension(obj)` identity/type helper (defineExtension.ts:54)
- [ ] **EXT-02** fields: `name` (unique), `config`, `mergeConfig`, `dependencies`, `peerDependencies`, `conflictsWith: string[]`, `init`, `build`, `register`, `afterRegistration`, plus InitialEditorConfig: `nodes` (array or thunk), `theme`, `html`, `namespace`, `editable`, `onError(error, editor)`, `parentEditor`, `disableEvents`, `dom`, `$initialEditorState` (types.ts:168; types.ts:361)
- [ ] **EXT-03** `configExtension(ext, ...partials)` → tuple `[ext, ...partials]` (defineExtension.ts:91)
- [ ] **EXT-04** `declarePeerDependency<E>(name, config?)` → `[name, config]` (defineExtension.ts:127)
- [ ] **EXT-05** `shallowMergeConfig(config, overrides)`: returns same object if no overrides / identical / every key `===`; else `{...config,...overrides}` (shallowMergeConfig.ts:17)
- [ ] **EXT-06** `safeCast<T>(v)` identity (safeCast.ts:16)
- [ ] **EXT-07** `$initialEditorState`: null | JSON string | EditorState | SerializedEditorState object | `(editor)=>void` (types.ts:355)
- [ ] **EXT-08** lifecycle signatures: `init(editorConfig (mutable), config, initState) => Init`; `build(editor, config, buildState) => Output` (once, no cleanup); `register(editor, config, registerState) => cleanup` (before initial state); `afterRegistration(...) => cleanup` (types.ts:239-290)
- [ ] **EXT-09** initState: `getDependency(ext)`→{config}, `getPeer(name)`→{config}|undefined, `getDirectDependentNames()`, `getPeerNameSet()`; buildState adds full deps {config, init, output} + `getInitResult()`; registerState adds `getOutput()`, `getSignal()` (AbortSignal) (types.ts:70-137)

##### Builder — `buildEditorFromExtensions(...args)` (`lexical-extension/src/LexicalBuilder.ts`)
- [ ] **EXT-20** roots = `[InitialStateExtension, ...args]` (normalized to tuples) (LexicalBuilder.ts:139)
- [ ] **EXT-21** addExtension: name must be string; same name + different object → invariant "Multiple extensions registered with name"; same object → dedupe (no re-add) (LexicalBuilder.ts:261)
- [ ] **EXT-22** conflicts: adding X when a registered ext declared conflict with X → invariant; X's conflictsWith names already registered → invariant; records `conflicts[name]=X` (LexicalBuilder.ts:282)
- [ ] **EXT-23** dependencies: edge from→to with tuple configs, recurse addExtension; peerDependencies: edge only (config if given), not added (LexicalBuilder.ts:300)
- [ ] **EXT-24** topological sort: DFS post-order over extensionNameMap insertion order following outgoing edges (missing peers skipped); temporary mark revisit → "Circular dependency" invariant; dependencies come before dependents (LexicalBuilder.ts:311)
- [ ] **EXT-25** config collection: for each rep in sorted order, push its outgoing edge configs into target's ordered Set; then root-argument configs last → merge order = deepest dependents' overrides first … root args last (last wins under shallow merge); identical config object refs deduped by Set (LexicalBuilder.ts:354)
- [ ] **EXT-26** mergeConfigs: start `ext.config || {}`, fold with `ext.mergeConfig` (bound) or shallowMergeConfig (ExtensionRep.ts:240)
- [ ] **EXT-27** buildCreateEditorArgs in sorted order: later extension wins for onError, disableEvents, parentEditor, editable, namespace, $initialEditorState; nodes union (Set) — two extensions replacing the same klass → invariant; html.export Map merged (later wins per klass); html.import Object.assign (later wins per tag); theme deep-merged in place (LexicalBuilder.ts:405)
- [ ] **EXT-28** deepThemeMergeInPlace: recursive object merge; arrays and non-objects replaced (deepThemeMergeInPlace.ts:25)
- [ ] **EXT-29** then each rep.init(config) in sorted order (may mutate editor config, e.g. dom/parentEditor/theme); default onError throws (LexicalBuilder.ts:485)
- [ ] **EXT-30** constructEditor: createEditor(args) with onError wrapper `(err)=>onError(err, editor)`; attach builder via `Symbol.for('@lexical/extension/LexicalBuilder')`; then build each rep in sorted order (LexicalBuilder.ts:177)
- [ ] **EXT-31** buildEditor: register all reps (sorted) with one shared AbortSignal, then afterRegistration all; returns editor with `dispose()` and `[Symbol.dispose]` (once): runs cleanups in reverse (mergeRegister), aborts signal, `setRootElement(null)` (LexicalBuilder.ts:202,385)
- [ ] **EXT-32** ExtensionRep state machine unmarked→temporary→permanent→configured→initialized→built→registered→afterRegistration; invariants on out-of-order calls; dispose rolls back to built (ExtensionRep.ts:26,312)
- [ ] **EXT-33** getInitResult invariant if extension has no init (ExtensionRep.ts:371)
- [ ] **EXT-34** getDependency on extension not in registry → invariant; used before build → invariant (ExtensionRep.ts:433,472)
- [ ] **EXT-35** builder version check: editor built by different LexicalBuilder version/copy → invariant (LexicalBuilder.ts:149)
- [ ] **EXT-36** `getExtensionDependencyFromEditor(editor, ext)` → {config, init, output} or invariant (not built with builder / ext not present / name collision different object) (getExtensionDependencyFromEditor.ts:35)
- [ ] **EXT-37** `getPeerDependencyFromEditor(editor, name)` → dep or undefined (also undefined if editor not builder-made); `...OrThrow` variant (getPeerDependencyFromEditor.ts:44,100)
- [ ] **EXT-38** `$getExtensionDependency(ext)`, `$getExtensionOutput(ext)`, `$getPeerDependency(name)` use `$getEditor()` (getExtensionDependency.ts:44-103)
- [ ] **EXT-39** `getKnownTypesAndNodes(config)` → {types, nodes} resolving thunks & replacements (replace klass) (config.ts:28)
- [ ] **EXT-40** lexical core does NOT know about extensions: it only consumes the produced CreateEditorArgs (`dom`, `html`, nodes …) and `editor._config.dom` via `$getEditorDOMRenderConfig` (lexical/src/LexicalUtils.ts:2042)

##### Signals
- [ ] **EXT-50** re-export @preact/signals-core: signal, computed, effect, batch, untracked, types (signals.ts:8)
- [ ] **EXT-51** `namedSignals(defaults, opts={})`: one Signal per key of defaults, initial = opts[k] ?? defaults[k] (undefined → default) (namedSignals.ts:29)
- [ ] **EXT-52** `watchedSignal(getSnapshot, register)`: initial snapshot; on first watcher refresh value + subscribe; unsubscribe when unwatched (watchedSignal.ts:18)
- [ ] **EXT-53** common pattern: build → namedSignals(config); register → `effect(()=> disabled.value ? undefined : registerX(...))` so toggling signals re-registers

##### Built-in extensions (`lexical-extension/src/`)
- [ ] **XB-01** InitialStateExtension (`@lexical/extension/InitialState`, always root[0]): nodes [Root, Text, LineBreak, Tab, Paragraph]; config `{updateOptions:{tag:'history-merge'}, setOptions:{tag:'history-merge'}}`; init captures `$initialEditorState` (default: append paragraph if root empty) (InitialStateExtension.ts:51)
- [ ] **XB-02** InitialState afterRegistration (once): EditorState → setEditorState; function → `editor.update(fn(editor))`; string/object → parseEditorState+setEditorState; null → nothing (InitialStateExtension.ts:62)
- [ ] **XB-03** AutoFocusExtension (`@lexical/extension/AutoFocus`): config `{defaultSelection:'rootEnd'|'rootStart', disabled:false}`; on root set → `editor.focus(cb,{defaultSelection})`; VIEW cb focuses root (preventScroll) if activeElement not inside (AutoFocusExtension.ts:31)
- [ ] **XB-04** ClearEditorExtension (`@lexical/extension/ClearEditor`): `{$onClear}`; CLEAR_EDITOR_COMMAND (EDITOR priority, returns true) → `editor.update($onClear)`; default: root.clear, append paragraph, select it if selection existed, reset range format to 0; `registerClearEditor` exported (ClearEditorExtension.ts:24,43,60)
- [ ] **XB-05** EditorStateExtension (`@lexical/extension/EditorState`): output watchedSignal of current EditorState updated by update listener (EditorStateExtension.ts:15)
- [ ] **XB-06** NodeSelectionExtension (`@lexical/extension/NodeSelection`, dep EditorState): output `watchNodeKey(key) → computed<boolean>`; effect over editor state computes selected set among watched keys via `node.isSelected()`; unwatched keys pruned (NodeSelectionExtension.ts:30)
- [ ] **XB-07** HorizontalRuleExtension (`@lexical/extension/HorizontalRule`, deps EditorState+NodeSelection): HorizontalRuleNode type 'horizontalrule' (DecoratorNode, block, textContent '\n', exportDOM/createDOM `<hr>` + theme.hr, importDOM hr p0) (HorizontalRuleExtension.ts:51)
- [ ] **XB-08** INSERT_HORIZONTAL_RULE_COMMAND (EDITOR): Range selection only → `$insertNodeToNearestRoot(hr)`; returns true (HorizontalRuleExtension.ts:155)
- [ ] **XB-09** CLICK_COMMAND (LOW): click on HR DOM → toggle NodeSelection (shift adds to existing NodeSelection) (HorizontalRuleExtension.ts:112,175)
- [ ] **XB-10** VIEW HR selected class: `theme.hrSelected ?? 'selected'` toggled via mutation listener + signals (HorizontalRuleExtension.ts:152,189)
- [ ] **XB-11** TabIndentationExtension (`@lexical/extension/TabIndentation`): config `{disabled:false, maxIndent:null, $canIndent: node=>node.canIndent()}` (TabIndentationExtension.ts:149)
- [ ] **XB-12** KEY_TAB_COMMAND (EDITOR): Range only; preventDefault; `$indentOverTab` → INDENT/OUTDENT (shift) else INSERT_TAB_COMMAND (TabIndentationExtension.ts:85)
- [ ] **XB-13** `$indentOverTab`: true if any selected block canIndent, or the earlier point is at start of its nearest block (that canIndent) (TabIndentationExtension.ts:40)
- [ ] **XB-14** INDENT_CONTENT_COMMAND (CRITICAL): `$handleIndentAndOutdent` increments indent when $canIndent and `!maxIndent || newIndent < maxIndent` (TabIndentationExtension.ts:102)
- [ ] **XB-15** **AMBIGUOUS** maxIndent is exclusive (maxIndent=3 allows indent ≤2) and maxIndent 0 means unlimited (TabIndentationExtension.ts:123)
- [ ] **XB-16** NestedEditorExtension (`@lexical/extension/NestedEditor`): config `{$getParentEditor (default $getEditor() asserting builder-made), inheritEditableFromParent:false}`; init sets editorConfig.parentEditor and inherits parent theme if none; register mirrors parent editable when enabled (NestedEditorExtension.ts:26)
- [ ] **XB-17** NormalizeInlineElementsExtension (`@lexical/NormalizeInlineElements`): adds transform to every registered ElementNode klass overriding isInline → remove empty inline elements; dev warn if canBeEmpty() true (NormalizeInlineElementsExtension.ts:43)
- [ ] **XB-18** NormalizeTripleClickSelectionExtension (`@lexical/NormalizeTripleClickSelection`): config `{disabled, thresholdMsec:100, dateNow, $fixFocusOverselection}`; VIEW detects mousedown/mouseup detail===3 then on SELECTION_CHANGE (BEFORE_CRITICAL) within threshold runs fix (NormalizeTripleClickSelectionExtension.ts:153) — R2.1 owners: model `Transaction::fix_focus_overselection` (lexical_model), plugin `lexical_rich_nodes::normalize_triple_click`, triple-click tracking web-view (S1 §14.4)
- [ ] **XB-19** `$fixFocusOverselection`: for non-collapsed range, pull focus back: out of next TextNode at offset 0, behind single LineBreak, out of start of elements, into end of containing element; set selection + eager DOM selection update with skip-focus/skip-scroll tags (NormalizeTripleClickSelectionExtension.ts:68) — R2.1 owners: model `Transaction::fix_focus_overselection` (lexical_model), plugin `lexical_rich_nodes::normalize_triple_click`, triple-click tracking web-view (S1 §14.4)
- [ ] **XB-20** ClickAfterLastBlockExtension (`@lexical/ClickAfterLastBlock`): config `{disabled, $shouldInsertAfter=$defaultShouldInsertAfter (decorator or shadow-root element)}`; VIEW click on root itself below last child's bottom (editable) → insert paragraph after last child + select; mousedown preventDefault; stopLexicalPropagation (ClickAfterLastBlockExtension.ts:40,133) — R2.1 owners: model `lexical_rich_nodes::click_after_last_block`, DOM hit test web-view (S1 §14.4)
- [ ] **XB-21** SelectionAlwaysOnDisplayExtension (`@lexical/utils/SelectionAlwaysOnDisplay`): `{disabled, onReposition}` → selectionAlwaysOnDisplay (UTL-60) (SelectionAlwaysOnDisplayExtension.ts:24)
- [ ] **XB-22** DecoratorTextExtension (`@lexical/extension/DecoratorText`): DecoratorTextNode type 'decorator-text', inline, `format` flat NodeState (number, default 0), get/has/set/toggleFormat, createDOM span; FORMAT_TEXT_COMMAND (LOW, returns false) toggles format on all DecoratorTextNodes in Range/Node selection (DecoratorTextExtension.ts:44,195)
- [ ] **XB-23** `applyFormatFromStyle(node, style, shouldApply?)` — same additive Google-Docs style mapping as HTML-24 (DecoratorTextExtension.ts:105)
- [ ] **XB-24** VIEW `applyFormatToDom(node, dom, map)` wraps dom in tag per active format (DecoratorTextExtension.ts:156)
- [ ] **XB-25** **AMBIGUOUS** default map has b+strong (bold) and em+i (italic) → bold node wrapped in both `<b>` and `<strong>` (DecoratorTextExtension.ts:178)
- [ ] **XB-26** (other packages) GetClipboardData/ClipboardImport/History/SharedHistory/DOMRender/DOMImport/Core/HRImport extensions — see CLP/HIS/HREN/HIMP

##### @lexical/headless (`lexical-headless/src/`)
- [ ] **HDL-01** `createHeadlessEditor(config?)` = createEditor + `_headless=true`; methods registerDecoratorListener, registerRootListener, registerMutationListener, getRootElement, setRootElement, getElementByKey, focus, blur replaced by throwers "X is not supported in headless mode" (index.ts:19)
- [ ] **HDL-02** `@lexical/headless/dom` `withDOM(f)`: if global window exists → f(window); else temporarily install happy-dom Window, document, MutationObserver, DOMParser, getComputedStyle, run f, restore and close window (dom.ts:32)
- [ ] **HDL-03** browser build of `/dom`: invariant global window exists, f(window) (dom.browser.ts:10)

##### @lexical/yjs — REFERENCE ONLY for lexical_loro (`lexical-yjs/src/`)
- [ ] **YJS-01** Binding (v1): `{clientID, cursors, cursorsContainer, doc, docMap, editor, id, nodeProperties, excludedProperties, collabNodeMap, root}`; root = CollabElementNode over `doc.get('root', XmlText)` with key 'root' (Bindings.ts:26,84)
- [ ] **YJS-02** mapping v1: ElementNode ↔ Y.XmlText (children as embeds + text runs; properties as XmlText attributes); TextNode ↔ Y.Map (properties) embedded in parent XmlText followed by its characters (size = len+1); LineBreak ↔ Y.Map `{__type:'linebreak'}` (size 1); DecoratorNode ↔ Y.XmlElement (attributes) (size 1) (Utils.ts:150; CollabTextNode.ts:94)
- [ ] **YJS-03** `__type` attribute identifies node type on every shared type; unknown/unregistered → invariant (Utils.ts:193,204)
- [ ] **YJS-04** synced properties = own enumerable non-function fields of a fresh `new klass()` minus excluded: `__key,__parent,__next,__prev,__state`; elements `__first,__last,__size`; root `__cachedText`; text `__text`; plus per-klass `excludedProperties` (Utils.ts:45,60,90)
- [ ] **YJS-05** NodeState `__state` synced as nested Y.Map under `__state` key: known states unparsed, unknown copied; incremental via YMapEvent on that map (Utils.ts:390,404; SyncEditorStates.ts:~60)
- [ ] **YJS-06** nested editors (LexicalEditor property values) ↔ Y.Doc subdocs registered in docMap by guid; reuse existing nested editor when re-syncing (Utils.ts:330,465)
- [ ] **YJS-07** `syncLexicalUpdateToYjs`: inside `doc.transact(fn, binding)`; skip if tags collaboration/historic (only resolve normalization merges: merged text nodes update collab text, removed ones delete their embed); if root dirty → diff properties and children recursively (keyed two-pointer diff on child keys: remove / create+replace / insert / append / trim) then sync selection to awareness (SyncEditorStates.ts:~250; CollabElementNode.ts:457)
- [ ] **YJS-08** text changes encoded via `simpleDiffWithCursor(prev, next, cursorOffset)` → single delete+insert at common prefix (cursor-biased)/suffix (simpleDiffWithCursor.ts:9)
- [ ] **YJS-09** `syncYjsChangesToLexical(binding, provider, events, isFromUndoManager)`: precompute deltas; editor.update with `skipTransforms`, tag historic (undo manager) or collaboration; per event: XmlText events → properties (keysChanged) + childList delta; Map events → text props/text; XmlElement → attributes; recover cursor; add skip-scroll-into-view for remote; onUpdate sync cursors + ensure root non-empty (append paragraph) (SyncEditorStates.ts:~100)
- [ ] **YJS-10** selection recovery: if selection points at removed nodes/out-of-range offsets → restore from awareness relative positions, else move to previous sibling/parent end, else root start (Utils.ts:578,616)
- [ ] **YJS-11** cursors: awareness local state `{anchorPos, focusPos (Y.RelativePosition), name, color, focusing, awarenessData}`; text point offset = textNodeOffsetInParent + 1 + offset; element point offset sums child sizes; update only if changed (SyncCursors.ts:73,766)
- [ ] **YJS-12** VIEW remote cursor rendering: per remote client caret + selection rects in cursorsContainer, theme.collaboration; destroy cursors for departed clients (SyncCursors.ts:688)
- [ ] **YJS-13** `createUndoManager(binding, root)` = Y.UndoManager tracking origins {binding, null} (index.ts:90)
- [ ] **YJS-14** commands CONNECTED_COMMAND, TOGGLE_CONNECT_COMMAND, DIFF_VERSIONS_COMMAND__EXPERIMENTAL, CLEAR_DIFF_VERSIONS_COMMAND__EXPERIMENTAL; initLocalState / setLocalStateFocus (index.ts:34-139)
- [ ] **YJS-15** v2 (experimental, y-prosemirror style): root `doc.get('root-v2', XmlElement)`; element → XmlElement(nodeName=type) with attributes = non-default properties + `s_`-prefixed NodeState; consecutive TextNodes → one XmlText with formatting in delta attributes; CollabV2Mapping shared-type↔node(s); full-state `syncYjsStateToLexicalV2`; discrete updates (SyncV2.ts:341,642; CollabV2Mapping.ts:16; SyncEditorStates.ts:~380)
- [ ] **YJS-16** renderSnapshot__EXPERIMENTAL / $getYChangeState: version diffs need gc disabled; ychange stored as NodeState (RenderSnapshot.ts:22-59)

---

#### 5. @lexical/selection (`lexical-selection/src/`)

- [ ] **LSEL-00** exports: $addNodeStyle, $ensureForwardRangeSelection, $forEachSelectedTextNode, $isAtNodeEnd, $patchStyleText, $sliceSelectedTextNodeContent, $trimTextContentFromAnchor, $copyBlockFormatIndent, $getSelectionStyleValueForProperty, $isParentElementRTL, $moveCaretSelection, $moveCharacter, $setBlocksType, $shouldOverrideDefaultCharacterSelection, $wrapNodes, $getComputedStyleForElement, $getComputedStyleForParent, $isParentRTL, createDOMRange, createRectsFromDOMRange, getCSSFromStyleObject; deprecated aliases getStyleObjectFromCSS, trimTextContentFromAnchor, $cloneWithProperties, $selectAll (index.ts:13-47)

##### Style parsing
- [ ] **LSEL-01** `getStyleObjectFromCSS(css)` (core): char scanner; `/* */` comments skipped; quotes and backslash escapes preserved verbatim; `:`/`;` ignored inside parentheses; first `:` splits prop/value; trims; drops empty prop or value; last decl without `;` kept; later duplicate wins (lexical/src/utils/setDOMStyle.ts:18)
- [ ] **LSEL-02** no CSS cache anymore: parsed on demand; `$addNodeStyle` is a deprecated warn-once no-op (lexical-node.ts:246)
- [ ] **LSEL-03** `getCSSFromStyleObject(obj)` → `prop: value;` concatenated, no spaces between decls, skips empty prop key (utils.ts:186)
- [ ] **LSEL-04** VIEW setDOMStyleObject: `!important` suffix → priority, null value → removeProperty (lexical/src/utils/setDOMStyle.ts:146)

##### $patchStyle / $patchStyleText
- [ ] **LSEL-10** `$patchStyle(target, patch)`: target TextNode / ElementNode (uses textStyle) / collapsed RangeSelection else invariant; patch value string sets, `null` deletes, function `(current|undefined, target)=>string` computes; result written via setStyle/setTextStyle (lexical-node.ts:257)
- [ ] **LSEL-11** `$patchStyleText(selection, patch)`: collapsed Range → patch selection.style, and if anchor node is an empty element also its textStyle (lexical-node.ts:319)
- [ ] **LSEL-12** then `$forEachSelectedTextNode` patches each selected text node (lexical-node.ts:326)
- [ ] **LSEL-13** then every selected empty ElementNode with canBeEmpty() gets textStyle patched (deduped) (lexical-node.ts:330)
- [ ] **LSEL-14** `$forEachSelectedTextNode(fn)`: uses `$getSelection()` (NOT the passed selection); slice indices from caret range text slices; skip non-formattable (`canHaveFormat()` false) and zero-width slices; whole node or token/segmented → fn(node); partial → `splitText(start,end)` and fn on the selected piece (index 0 if start==0 else 1) (lexical-node.ts:351)
- [ ] **LSEL-15** **AMBIGUOUS** `$patchStyleText(sel)` with sel ≠ current selection patches text nodes of the current selection (lexical-node.ts:354)
- [ ] **LSEL-16** after forEach, single-text-node range selection forced forward via `$ensureForwardRangeSelection` (compat side-effect) (lexical-node.ts:407)
- [ ] **LSEL-17** `$ensureForwardRangeSelection(sel)`: if backward swap anchor/focus in place (lexical-node.ts:426)

##### Other text helpers
- [ ] **LSEL-20** `$sliceSelectedTextNodeContent(sel, textNode, 'self'|'clone')`: only if node selected, not token/segmented, and has endpoints; if node is anchor or focus slice its `__text` to the selected range (same node: min..max; first: offset..end; last: 0..offset); 'clone' clones ephemerally before direct `__text` mutation; unchanged → original returned (lexical-node.ts:44)
- [ ] **LSEL-21** `$isAtNodeEnd(point)`: text → offset==textSize; element → offset==childrenSize; other → invariant (lexical-node.ts:103)
- [ ] **LSEL-22** `$trimTextContentFromAnchor(editor, anchor, delCount)`: start at anchor node (descendant at element offset); loop backwards removing whole nodes (non-text, or text fully consumed; remove emptied non-root parent; block boundary costs 2 extra; empty block counts as '\n\n'); partial text: if previous editor state had different simple text → revert to previous text (restore collapsed prev selection); else split & remove excess around anchor; non-simple text → replace with sliced plain TextNode (lexical-node.ts:124)

##### Range-selection helpers (range-selection.ts)
- [ ] **LSEL-30** `$copyBlockFormatIndent(src, dest)`: copy formatType and indent when different (range-selection.ts:42)
- [ ] **LSEL-31** `$setBlocksType(sel, $createElement, $after=$copyBlockFormatIndent)`: null sel → no-op; collect blocks (`INTERNAL_$isBlock` = block element) for anchor & focus nearest blocks, plus every selected block element; skip focus block if it differs from anchor block and focus is at its start (offset 0, no previous siblings up the chain, non-empty); for selections without endpoints (Node/Table) use ancestor block of each node; for each block: create, $after(prev, new), `prev.replace(new, true)` (keep children; selection remap delegated to replace) (range-selection.ts:86)
- [ ] **LSEL-32** `$isPointAtBlockStart`: empty element point → false (treated as entire block) (range-selection.ts:56)
- [ ] **LSEL-33** `$wrapNodes(sel, createElement, wrappingElement=null)`: empty/only-empty-element selection → wrap anchor's block (text → parent) children into new element (copy format/indent), optional wrapper, `target.replace(element)` (range-selection.ts:170)
- [ ] **LSEL-34** otherwise chunk nodes per root/shadow-root (tables cells handled separately) and `$wrapNodesImpl` each chunk (range-selection.ts:206)
- [ ] **LSEL-35** `$wrapNodesImpl`: insertion target = previous sibling of first node's block (or climb to root); for each leaf node's parent (skipping inline parent) create one element (copy format/indent), move ALL parent's children in, remove emptied ancestors; empty top-level elements each become a new element (old removed); append into wrappingElement if given; insert after prev sibling or before first root child / append; restore prev selection if attached, else select end of last element, else mark selection dirty (range-selection.ts:258)
- [ ] **LSEL-36** `$shouldOverrideDefaultCharacterSelection(sel, isBackward)`: flip direction for `writing-mode: vertical-rl` and for RTL parent; false if focus caret is extendable text; walk caret range: entering child caret → `!isInline()`; skip element siblings; decorator → true; else false (range-selection.ts:473)
- [ ] **LSEL-37** `$moveCaretSelection(sel, shift, backward, granularity)` → `sel.modify(shift?'extend':'move', backward, granularity)` (range-selection.ts:514)
- [ ] **LSEL-38** `$moveCharacter(sel, shift, backward)`: invert direction if vertical-rl or RTL; granularity 'character' (range-selection.ts:539)
- [ ] **LSEL-39** VIEW `$isParentElementRTL(sel)`: computed style of anchor element (or anchor's parent) direction==='rtl'; `$isParentRTL(node)`, `$getComputedStyleForElement/Parent` (range-selection.ts:528; utils.ts:203-238)
- [ ] **LSEL-40** `$getSelectionStyleValueForProperty(sel, prop, default='')`: collapsed Range with non-empty `selection.style` containing prop → that value; otherwise iterate selected TextNodes, excluding first node if start offset at its end and (for i>0) last node if end offset 0; all equal → value (missing prop → default); mixed → ''; no text nodes → default (range-selection.ts:603)
- [ ] **LSEL-41** `$selectAll(sel?)` (core): Range → expand to anchor's top-level parent container (root or shadow root) 0..childrenSize then normalize; else create root.select(0,size) normalized and set (lexical/src/LexicalUtils.ts:1231)

##### VIEW
- [ ] **LSEL-50** VIEW `createDOMRange(editor, anchorNode, aOff, focusNode, fOff)`: resolve DOM via getElementByKey, descend to text node for TextNodes; `<br>` → (parent, index); same element with first child `<br>` and both offsets 0 → focusOffset 1; setStart/End errors → null; collapsed-but-different → reversed (utils.ts:50)
- [ ] **LSEL-51** VIEW `createRectsFromDOMRange(editor, range)`: client rects sorted top-to-bottom (3px tolerance → left-to-right); drop rects overlapping previous and rects spanning full root width minus padding (utils.ts:127)

---

#### 6. @lexical/utils (`lexical-utils/src/index.ts` unless noted)

- [ ] **UTL-01** re-exports from core: $findMatchingParent, $getAdjacentSiblingOrParentSiblingCaret, $splitNode, addClassNamesToElement, isBlockDomNode, isHTMLAnchorElement, isHTMLElement, isInlineDomNode, mergeRegister, removeClassNamesFromElement, CAN_USE_*/IS_* env flags (index.ts:73)
- [ ] **UTL-02** `mergeRegister(...fns)` → cleanup calling fns in REVERSE order, then empties array (idempotent) (lexical/src/utils/mergeRegister.ts:34)
- [ ] **UTL-03** `$dfs(start?, end?)` = Array.from($dfsIterator) (index.ts:179)
- [ ] **UTL-04** `$dfsIterator(start=root, end?)`: pre-order `{depth, node}`; start node included (depth = $getDepth(start), root=0); element start iterates its subtree; end bound inclusive of end's subtree (stops at caret after end / its last descendant); without end, stops after start's subtree (index.ts:219,236)
- [ ] **UTL-05** `$reverseDfs` / `$reverseDfsIterator`: same with direction 'previous' (right-to-left pre-order mirror) (index.ts:204,327)
- [ ] **UTL-06** `$getDepth(node)`: root=0, null=-1 (index.ts:291)
- [ ] **UTL-07** `$getNextSiblingOrParentSibling(node)` → [next sibling or nearest ancestor's next sibling, depthDiff ≤0] or null (stops at root) (index.ts:282; lexical/src/caret/LexicalCaretUtils.ts:603)
- [ ] **UTL-08** `$getNextRightPreorderNode(node)`: previous-direction preorder from node's last descendant (index.ts:311)
- [ ] **UTL-09** `$getAdjacentCaret(caret)` (index.ts:192)
- [ ] **UTL-10** `$getNearestNodeOfType(node, Klass)` incl. self, instanceof (index.ts:341)
- [ ] **UTL-11** `$getNearestBlockElementAncestorOrThrow(node)`: nearest non-inline element (self included, root excluded) else invariant (index.ts:363)
- [ ] **UTL-12** `$findMatchingParent(start, pred)`: tests self then ancestors, stops BEFORE root (never returns RootNode) (lexical/src/LexicalUtils.ts:2456)
- [ ] **UTL-13** `registerNestedElementResolver(editor, Klass, clone, handleOverlap)`: transform on Klass; if node has no Klass children and its direct parent is Klass → handleOverlap(parent,node), move node after parent, move node's former next siblings into a clone of parent after node, remove parent if empty and !canBeEmpty; deep (non-direct) nesting unimplemented TODO (index.ts:396)
- [ ] **UTL-14** `$restoreEditorState(editor, state)`: pending state nodeMap ← clones of all nodes in state; `$fullReconcile()`; selection ← clone of state selection (index.ts:477)
- [ ] **UTL-15** `$insertNodeToNearestRoot(node)`: selection = current or previous; Range → caret at focus; other selection → after last selected node; none → append new paragraph at root end; insert via AtCaret; selection collapsed at normalized start of next child or at insert caret; returns latest node (index.ts:505)
- [ ] **UTL-16** `$insertNodeToNearestRootAtCaret(node, caret, splitOpts?)`: text caret at offset 0 → before text node; at end → after; caret on node itself → rewind; remove node if adjacent to insertion point; repeatedly `$splitAtPointCaretNext` until at root/shadow-root level (splitting all ancestors); invariant if still text caret; insert node (inline → wrapped in new paragraph); return caret after node in requested direction (index.ts:541)
- [ ] **UTL-17** `$insertNodeIntoLeaf(node)`: non-Range → `insertNodes([node])`; Range → remove selected text, split text at caret, insert node, collapse selection after it (index.ts:602)
- [ ] **UTL-18** `$wrapNodeInElement(node, create)`: replace node with element then append node (index.ts:633)
- [ ] **UTL-19** `$splitNode(node, offset)` (core): invariant not root/shadow; start = child at offset (or node itself if none); recursively copy ancestors up to root-level, moving start node and its next siblings into copies; returns [left, right] top-level elements (right inserted after left) (lexical/src/LexicalUtils.ts:1854)
- [ ] **UTL-20** `$insertFirst(parent, node)` → insert at child caret 'next' (start) (index.ts:727)
- [ ] **UTL-21** `$unwrapNode(node)`: replace node with its children (splice at node's position) (index.ts:916)
- [ ] **UTL-22** `$descendantsMatching(children, pred)`: pre-order; matched nodes returned WITHOUT descending; non-matching elements descended (index.ts:841)
- [ ] **UTL-23** `$unwrapAndFilterDescendants(root, pred)`: last-to-first; non-matching nodes removed, their matching descendants hoisted to the nearest matching/root position; returns didMutate (index.ts:791)
- [ ] **UTL-24** `$firstToLastIterator(el)` / `$lastToFirstIterator(el)`: child iteration resilient to mutation (step from latest caret), yields `getLatest()`; dev cycle invariant (index.ts:871,883,887)
- [ ] **UTL-25** `$filter(nodes, fn)`: map dropping nulls (index.ts:669)
- [ ] **UTL-26** `$handleIndentAndOutdent(fn)`: Range only; for each selected node, nearest non-inline element ancestor (self incl.) with canIndent, deduped → fn(block); returns whether any handled (index.ts:690)
- [ ] **UTL-27** `$isEditorIsNestedEditor(editor)` → `_parentEditor !== null` (index.ts:776)
- [ ] **UTL-28** `makeStateWrapper(stateConfig)` → `{stateConfig, $get, $set, accessors, makeGetterMethod, makeSetterMethod}` (index.ts:983)
- [ ] **UTL-29** `objectKlassEquals(obj, Klass)`: compares `getPrototypeOf(obj).constructor.name === Klass.name` (cross-realm, name-based; null → false) (index.ts:651)
- [ ] **UTL-30** `isMimeType(file, types)`: `file.type.startsWith(t)` for any (index.ts:108)
- [ ] **UTL-31** VIEW `mediaFileReader(files, types)`: sequentially readAsDataURL matching files, skip others; resolves [{file, result}] in order; reader error rejects (index.ts:131)
- [ ] **UTL-32** VIEW `calculateZoomLevel(el, useManualZoom=false)`: product of computed `zoom` up ancestors only when browser lacks standardized CSS zoom (probe once; Firefox/no-DOM → false) or forced (index.ts:731,759)
- [ ] **UTL-40** VIEW `markSelection(editor, onReposition=default)`: on each update, for RangeSelection compute ordered start/end DOM range (text → DOM text node; element → slot element + firstChildOffset); only rebuild when nodes/DOM/offsets changed; else tear down for non-range; default styling Highlight/HighlightText, marginTop -1.5px, paddingTop 4px, paddingBottom 0 (markSelection.ts:68,98)
- [ ] **UTL-41** VIEW `positionNodeOnRange(editor, range, onReposition)`: relative wrapper div prepended to root's parent; one absolute div per rect (createRectsFromDOMRange) offset from parent; reuse nodes; call onReposition only when something moved; MutationObserver on parent (attributes, characterData, childList, subtree) repositions (ignoring own wrapper) or restarts on root/parent change; root listener restart; cleanup removes all (positionNodeOnRange.ts:38)
- [ ] **UTL-42** VIEW `selectionAlwaysOnDisplay(editor, onReposition?)`: on document selectionchange: DOM selection inside root → remove mark; outside → markSelection (persist highlight when blurred) (selectionAlwaysOnDisplay.ts:13)

## 4. Playground nodes and transformers worth noting (not a library; P2)

The playground ships no public exports. Its nodes matter in two ways. The Playwright e2e suites (62 + 29 specs) serialize them, so the shim must host them as `ForeignNode`s (SCOPE D2). Several of them also mirror Macro's own nodes, so they are good design checks for `macro_document_model`.

| ✓ | Node (type) | Base | Note |
|---|---|---|---|
| [ ] | `ImageNode` (`image`) | DecoratorNode | src/alt/size/caption is a **nested editor**; it exercises nested-editor JSON |
| [ ] | `PollNode` (`poll`) | DecoratorNode via `$config` | options array in JSON; `$config` + NodeState example |
| [ ] | `DateTimeNode` (`datetime`) | DecoratorNode via `$config` | NodeState-backed props |
| [ ] | `StickyNode` (`sticky`) | DecoratorNode | nested editor for the caption |
| [ ] | `EquationNode` (`equation`) | DecoratorNode | inline/block flag; markdown `$...$` transformer |
| [ ] | `ExcalidrawNode` (`excalidraw`) | DecoratorNode | opaque JSON data |
| [ ] | `PageBreakNode` (`page-break`) | DecoratorNode | block decorator |
| [ ] | `TweetNode` / `YouTubeNode` / `FigmaNode` | DecoratorBlockNode (react) | element `format` carried on a decorator |
| [ ] | `MentionNode` (`mention`) | TextNode | token-mode text subclass (compare Macro mentions) |
| [ ] | `EmojiNode` (`emoji`) | TextNode | className text subclass |
| [ ] | `KeywordNode` (`keyword`) | TextNode | text-entity example |
| [ ] | `SpecialTextNode` (`specialText`) | TextNode | `[text]` text-entity |
| [ ] | `LayoutContainerNode` / `LayoutItemNode` | ElementNode | `templateColumns`; shadow-root-like children |
| [ ] | `CollapsibleContainerNode` / `CollapsibleTitleNode` / `CollapsibleContentNode` | ElementNode (title uses `$config`) | `open` flag; custom insertNewAfter/collapseAtStart; `isShadowRoot` |
| [ ] | `PageNode` / `PageContentNode` (PagesExtension) | ElementNode via `$config` | newest `$config` style |
| [ ] | Markdown `HR`, `IMAGE`, `EMOJI`, `EQUATION`, `TWEET`, **`TABLE`** (`PLAYGROUND_TRANSFORMERS`) | transformers | `TABLE` is the reference for markdown tables (pipe rows, header separator). Macro has its own table transformer in its 74 transformers. |

## 5. Ambiguities and judgement calls

- **AMBIGUOUS — extension system home.** `defineExtension`, `configExtension`, `LexicalBuilder` and friends are classified MODEL with crate `lexical_model (registry) + shim`. SCOPE §2b wants an idiomatic Rust registry rather than upstream's API shape. The ordering, dedupe, conflict and config-merge *semantics* (§3.10) still have to match for the shim to pass the extension tests (`@lexical/extension` has 26 P1 symbols). Decide whether Rust owns the builder or the shim does.
- **AMBIGUOUS — HTML.** All 83 `@lexical/html` exports are BRIDGE. Export (`$generateHtmlFromNodes`, render context, `DOMRenderExtension`) → `lexical_html`. Import (`$generateNodesFromDOM`, the whole rule-based `DOMImportExtension` family under `src/import/`) → JS, per SCOPE ("import stays in JS"): R2.1 targets the legacy `importDOM` path at `web-view` (S12 V-4, the view sends `ClipboardPayload::html_nodes`) and the rest at `not-needed` (S12 §4). If native paste is ever needed, the import rows move to Rust.
- **AMBIGUOUS — clipboard.** The JSON half (`$generateJSONFromSelectedNodes`, `$generateNodesFromSerializedNodes`, `$insertGeneratedNodes`, the `application/x-lexical-editor` envelope) is MODEL. `DataTransfer` and HTML handling is BRIDGE. The table puts clipboard under `lexical_model`; it could equally be its own module.
- **Selection ops that need layout.** `RangeSelection.modify` with `lineboundary` granularity, `DELETE_LINE_COMMAND`, `DELETE_WORD_COMMAND` and `$moveCharacter` depend on DOM `Selection.modify` upstream. They are BRIDGE: the model needs a "move by line" input from the view. Word boundaries can be pure Rust (Intl.Segmenter equivalent); line boundaries cannot.
- **Commands.** Every command constant must exist in Rust, because dispatch and handler priority are model. Those whose payload is a DOM event (`KEY_*`, `PASTE`, `COPY`, `CUT`, `DROP`, `DRAG*`, `CLICK`, `FOCUS`, `BLUR`, `SELECTION_CHANGE`, `CONTROLLED_TEXT_INSERTION`, `SELECT_ALL`, `MOVE_TO_*`, `BEFORE_INPUT`, `INPUT`, `COMPOSITION_*`) are BRIDGE: the Rust handler takes a view-neutral event struct.
- **UPDATE TAGS.** `SKIP_DOM_SELECTION_TAG`, `SKIP_SCROLL_INTO_VIEW_TAG` and `SKIP_SELECTION_FOCUS_TAG` are view-consumed, but they must round-trip through `Commit`, so they are BRIDGE.
- **Code highlighting is P0 model, not view.** Macro stores Prism `CodeHighlightNode`s (`highlightType`) in synced docs, so the Prism tokenizer's token→node flattening must be byte-compatible in Rust (SCOPE D6). `@lexical/code-shiki` is P2 (style-carrying tokens, async grammars).
- **`@lexical/yjs` is not ported.** All 31 exports are `lexical_loro (reference only)`. The behaviours in §3D.4 (yjs: excluded properties, cursor mapping, undo origin) are what `lexical_loro` must reproduce over Loro.
- **`@lexical/react` (129 exports): 0 Macro imports.** All are VIEW except the re-exported model helpers (`registerTabIndentation`, `createLinkMatcherWithRegExp`, `DecoratorBlockNode` = BRIDGE). The model rules hidden inside React plugins are listed in §3B.4 so that none is lost.
- **Deprecated but used.** `$nodesOfType` (P0), `$wrapNodes`, `insertList`/`removeList`, `toggleLink`, `normalizeCodeLang`, and the `__EXPERIMENTAL` table aliases still have to exist in the shim.
- **Kind detection.** `const` values that are functions assigned by alias (e.g. `getStyleObjectFromCSS = getStyleObjectFromCSS_`, the `@lexical/code` prism facades) show as `const`. Treat them as fns.
- **Macro patches** (list indent 4→2 in markdown, table `$clearText`) are upstream behaviour *changes*. §3C ("Macro patches") states the upstream rule and the patched rule. The Rust port implements the patched rule behind config.

## R2.1 consistency

Final pass against S1-api.md R2.1 ("Changes other specs must make", S2 items) and S12 §0.2. S1 is the source of truth.

| Item | Change |
| --- | --- |
| G-2 (S1 §0) | §3D `SEL-00`..`SEL-51` renamed `LSEL-nn` (30 items). §3A `SEL-nn` and every cross-reference to them (EL-06, TX-04, SEL-42) unchanged; no in-file reference pointed at a §3D id |
| S12 §0.2 / V-7 `native-view` | Replaced by the S12 §4.2 owner of each row, matched by S2 line and symbol (451 rows, all matched): `native-view` → `web-view` 74, `shim` 7, `not-needed` 156; `X + native-view` → `X + web-view` 71, `X + shim` 31, `X + not-needed` 17. Two MODEL rows S12 does not list (`@lexical/devtools-core` `generateContent`, `registerLexicalCommandLogger`) → `not-needed`. Legend (How to read) and §1 primary-target counts updated |
| S12 §0.2 `shim-only (JS HTML import)` | 66 rows retargeted per S12 §4.2: the legacy `importDOM` path → `web-view` (11), the rest of the rule-based DOM import → `not-needed` (55). Legend and §5 HTML bullet updated |
| S1 §14.4 / G-10 `@lexical/extension` built-ins | ClearEditor (3 rows) and TabIndentation (4 rows, plus the `@lexical/react` re-export of `registerTabIndentation`) → `lexical_rich_nodes`. HorizontalRule (6 + 3 react re-export rows), DecoratorText (3), `applyFormatFromStyle`/`applyFormatToDom`, NormalizeInlineElements (2) → `not-needed (S3 §1a.17)` (upstream JS in Tier B). `EditorStateExtension`, `NestedEditorExtension` → `not-needed` (S1 §14.4 n/a). Builder and lookups (`LexicalBuilder`, `buildEditorFromExtensions`, `$getExtensionDependency`, `$getPeerDependency`, `getKnownTypesAndNodes`, `InitialState*`, `NodeSelectionExtension`) stay `lexical_model` (`EditorBuilder`, `extension`, `try_extension`, `Registry::types`, `initial_state`) |
| S1 §14.4 NormalizeTripleClickSelection | Extension → `lexical_model + lexical_rich_nodes + web-view` (model `Transaction::fix_focus_overselection`, plugin `lexical_rich_nodes::normalize_triple_click`, triple-click tracking web-view); Config/Output → `lexical_rich_nodes`. XB-18/XB-19 annotated |
| S1 §14.4 ClickAfterLastBlock | Extension → `lexical_rich_nodes + web-view` (model `lexical_rich_nodes::click_after_last_block`, DOM hit test web-view; S12 §4.2 says `not-needed`, S1 §14.4 wins); Config/Output/`$defaultShouldInsertAfter` → `lexical_rich_nodes`. XB-20 annotated |
| G-10 `@lexical/history`, `@lexical/file` | Already `lexical_model`; S1 §12 (history) and §13.6 (`SerializedDocument`) hold the mapping. Their view halves follow S12 (`exportFile`/`importFile` → S12 owners) |
| G-1 `Src` column | Not added as a column: §3's header now states that each item's trailing `(file:line)` cite is its `Src` range, which S4's matrix generator already parses. `/// s2:` owner lines are S1/S3's |
| Stale S1 identifiers | Grepped for `ViewPlatform`, `CoreConfig.platform`, `CommitHook`, `MergeActionGetter`, the `wire` feature, `has_current`: none in S2 (the one `createMergeActionGetter` hit is upstream's name) |

S4's matrix generator reads S2: rerun `S4-matrix-gen.ts` after this pass (the §3D ids are now `LSEL-nn`; target strings changed on 448 export rows).
