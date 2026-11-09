// Reviewed existing contracts; each row covers only the named assertions.
// Mock-only editor focus and forced setIndent fallbacks are excluded.
export const EDITOR_EXISTING_BEHAVIOR_MAP = [
  {
    source: ['apps/web/patches/@lexical%2Ftable', '0.45.0.patch'].join('@'),
    anchor: 'diff --git a/dist/LexicalTable.dev.mjs',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableClear.test.ts',
    cases: [
      'table cell clearing clears the selected cells on Backspace',
      'table cell clearing clears the selected cells on Delete',
      'table cell clearing clears the selected cells on cut',
      'table cell clearing leaves each cleared cell with a childless paragraph (no empty TextNode)',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.ts',
    anchor: 'export function $getConvertibleListFromSelection',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.test.ts',
    cases: [
      'list to table conversion finds the convertible list from a selection inside it, but not elsewhere',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.ts',
    anchor: 'export function $listToGrid',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.test.ts',
    cases: [
      'list to table conversion reads the grid without mutating the list',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.ts',
    anchor: 'export function registerListToTableCommand',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.test.ts',
    cases: [
      'list to table conversion handles nested lists embedded directly in their parent item',
      'list to table conversion keeps content nested deeper than two levels as a list inside the cell',
      'list to table conversion marks the first row as header cells',
      'list to table conversion pads ragged columns with empty cells',
      'list to table conversion preserves inline formatting when moving content into cells',
      'list to table conversion rejects a flat list',
      'list to table conversion rejects a list where a top-level item has no nested content',
      'list to table conversion rejects a single-column list',
      'list to table conversion rejects checklists',
      'list to table conversion turns top-level items into columns and nested items into rows',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTable.ts',
    anchor: 'export function registerListToTableCommand',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/listToTableUndo.test.ts',
    cases: [
      'list to table conversion in a collaborative document undoes back to the nested list, with the ids the shared document has',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts',
    anchor: 'export function $applyResizeDrag',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.test.ts',
    cases: [
      'table column resize drag clamps the column to the minimum width',
      'table column resize drag resizes the last spanned column of a merged cell',
      'table column resize drag resizes the previous column when dragging a left edge',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts',
    anchor: 'export function $applyRowResizeDrag',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.test.ts',
    cases: [
      'table row resize drag clamps the row to the minimum height',
      'table row resize drag resizes the last spanned row of a merged cell',
      'table row resize drag writes height only on the dragged row, leaving siblings unset',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts',
    anchor: 'export function $captureResizeDrag',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.test.ts',
    cases: [
      'table column resize drag captures rendered column widths and applies the delta live',
      'table column resize drag has no drag for the left edge of the first column',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts',
    anchor: 'export function $revertResizeDrag',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.test.ts',
    cases: [
      'table column resize drag reverts a cancelled drag to the pre-drag colWidths',
      'table column resize drag reverts to unset colWidths when the table had none',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts',
    anchor: 'export function $revertRowResizeDrag',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.test.ts',
    cases: [
      'table row resize drag reverts a cancelled drag to the pre-drag height',
      'table row resize drag reverts to unset height when the row had none',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableDelete.ts',
    anchor: 'export function $deleteTableAtHover',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableDelete.test.ts',
    cases: [
      '$deleteTableAtHover deletes a single row from a caret in the hovered cell',
      '$deleteTableAtHover deletes every selected column when the hovered cell is in that column range',
      '$deleteTableAtHover deletes every selected row when the hovered cell is in that row range',
      '$deleteTableAtHover deletes only the hovered column when it is outside the selection',
      '$deleteTableAtHover deletes only the hovered row when it is outside the selection',
      '$deleteTableAtHover deletes selected rows when hovering a cell in those rows outside the selected columns',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableListTab.ts',
    anchor: 'export function registerTableListTab',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableListTab.test.ts',
    cases: [
      'tab inside lists in table cells falls through to cell navigation once the item cannot indent deeper',
      'tab inside lists in table cells indents a list item instead of hopping to the next cell',
      'tab inside lists in table cells navigates to the previous cell on Shift+Tab at the top level',
      'tab inside lists in table cells outdents a nested list item on Shift+Tab',
      'tab inside lists in table cells still navigates cells from plain paragraph content',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tablePlugin.ts',
    anchor: 'function _registerTablePlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellContent.test.ts',
    cases: [
      'table cell allowed content keeps a bullet list appended to a table cell',
      'table cell allowed content keeps a check list appended to a table cell',
      'table cell allowed content keeps a date mention appended to a table cell',
      'table cell allowed content keeps a number list appended to a table cell',
      'table cell allowed content keeps a video appended to a table cell',
      'table cell allowed content keeps an image appended to a table cell',
      'table cell allowed content keeps cell text when converting a paragraph to a bullet list',
      'table cell allowed content keeps cell text when converting a paragraph to a number list',
      'table cell allowed content preserves stray text and inline links in paragraphs, in order',
      'table cell allowed content still strips nested tables from cells',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableSelectAll.ts',
    anchor: 'export function registerTableSelectAll',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableSelectAll.test.ts',
    cases: [
      'tableSelectAll escalates to the document when the table is already fully selected',
      'tableSelectAll expands a partial cell selection to the whole table',
      'tableSelectAll leaves select-all alone outside tables',
      'tableSelectAll selects the whole table when the caret is in a cell',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableTabInsertRow.ts',
    anchor: 'export function registerTableTabInsertRow',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableTabInsertRow.test.ts',
    cases: [
      'tab in the bottom-right table cell adds a new row and moves the caret into its first cell',
      'tab in the bottom-right table cell does not add a row from a non-terminal cell',
      'tab in the bottom-right table cell does not add a row on Shift+Tab in the bottom-right cell',
      'tab in the bottom-right table cell indents an indentable list item instead of inserting a row',
      'tab in the bottom-right table cell inserts a row once the bottom-right list item can no longer indent',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableTouchSelection.ts',
    anchor: 'function registerTableTouchSelection',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableTouchSelection.test.ts',
    cases: [
      'table touch selection blocks scrolling only while selecting',
      'table touch selection does nothing on a quick tap',
      'table touch selection does nothing when the finger drifts before the long press fires',
      'table touch selection extends the selection while swiping across cells',
      'table touch selection ignores mouse pointers',
      'table touch selection keeps the selection after the finger lifts',
      'table touch selection leaves the caret alone when a table is only scrolled past',
      'table touch selection scrolls instead of selecting when the drag starts before the long press',
      'table touch selection selects the pressed cell after a long press',
      'table touch selection still lets a mouse drag select cells',
      'table touch selection suppresses the long-press context menu during the gesture',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/restore-focus/restoreFocusPlugin.ts',
    anchor: 'export function restoreFocusPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/restore-focus/restoreFocusPlugin.test.ts',
    cases: [
      'applies the default selection (undefined) over the native caret',
      'applies the default selection (rootEnd) over the native caret',
      'keeps the selection the editor already had',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/code/deleteCodeNode.ts',
    anchor: 'export function deleteCodeNode',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/code/deleteCodeNode.test.ts',
    cases: [
      'deleteCodeNode replaces a sole code block with an empty paragraph',
      'deleteCodeNode moves selection to the following block when deleting from the start',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-triple-click/normalizeTripleClickPlugin.ts',
    anchor: 'export function $fixFocusOverselection',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-triple-click/normalizeTripleClickPlugin.test.ts',
    cases: [
      'normalizeTripleClickPlugin pulls an over-selected focus back to the end of the selected block',
      'normalizeTripleClickPlugin deleting a triple-selected heading does not restyle the paragraph below',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/word-navigation/wordNavigationPlugin.ts',
    anchor: 'export function wordNavigationPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/word-navigation/wordNavigationPlugin.test.ts',
    cases: [
      'word navigation with a leading mention ctrl+left stays on the current word instead of jumping to the block start',
      'word navigation with a leading mention ctrl+left in ordinary text is left to the browser',
      'word navigation with a leading mention ctrl+left from just after the mention steps in front of it',
      'word navigation with a leading mention shift+ctrl+left from just after the mention extends back over it',
      'word navigation with a leading mention ctrl+right from before the mention does not jump to the end of the block',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/listSwipeIndentPlugin.ts',
    anchor: 'export function $indentListItem',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/listSwipeIndentPlugin.test.ts',
    cases: [
      '$indentListItem / $outdentListItem indents an item under the previous sibling',
      '$indentListItem / $outdentListItem indents the only item in a list',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/listSwipeIndentPlugin.ts',
    anchor: 'export function $outdentListItem',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/listSwipeIndentPlugin.test.ts',
    cases: ['$indentListItem / $outdentListItem outdents a nested item'],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/listSwipeIndentPlugin.ts',
    anchor: 'function registerListSwipeIndent',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/listSwipeIndentPlugin.test.ts',
    cases: [
      'list swipe indent cleanup removes the document listener and cancels an active swipe when unregistered with a mounted root',
      'list swipe indent cleanup removes the previous root listener while enabling swipes on a replacement root',
      '$indentListItem / $outdentListItem does not outdent an item already at the root',
      'list swipe indent gesture does not mutate a comment-only editor that Lexical marks editable',
      'list swipe indent gesture does not queue an editor update when edit permission is revoked during swipe',
      'list swipe indent gesture does not queue an editor update when edit permission is revoked after release',
      'list swipe indent gesture requires a new swipe if edit permission is granted after pointer-down',
      'list swipe indent gesture indents a list item on a right swipe',
      'list swipe indent gesture outdents a list item on a left swipe',
      'list swipe indent gesture does not indent on a vertical swipe',
      'list swipe indent gesture does not indent on a mouse drag',
      'list swipe indent gesture does not indent when the swipe is shorter than the commit threshold',
      'list swipe indent gesture indents the first item without moving the following sibling',
      'list swipe indent gesture does not indent when the editor is read-only',
      'list swipe indent with registerList creates a nested list for the group and undoes the move as one edit',
      'list swipe indent with registerList moves descendants with their parent in a bullet list',
      'list swipe indent with registerList moves descendants with their parent in a number list',
      'list swipe indent with registerList moves descendants with their parent in a check list',
      'list swipe indent with registerList outdents a first sibling with its descendants',
      'list swipe indent with registerList outdents a middle sibling with its descendants',
      'list swipe indent with registerList outdents a last sibling with its descendants',
      'list swipe indent with registerList indents and outdents the first bullet item with its descendants',
      'list swipe indent with registerList indents and outdents the first number item with its descendants',
      'list swipe indent with registerList indents and outdents the first check item with its descendants',
      'list swipe indent with registerList indents and outdents after list transforms run',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/links/linksPlugin.ts',
    anchor: 'function $handleAppendToMatch',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/links/linksPlugin.test.ts',
    cases: [
      'typing through an incomplete email TLD does not shrink an autolink label when the rematch is shorter',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/links/linksPlugin.ts',
    anchor: 'function $unlinkSelection',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/links/linksPlugin.test.ts',
    cases: [
      'composer link persistence removes an entire formatted label when multiple children are selected',
      'composer link persistence keeps a typed https://example.com/a%20b link removed after saving and opening the editor again (protocol=false)',
      'composer link persistence keeps a imported https://example.com/a%20b link removed after saving and opening the editor again (protocol=false)',
      'composer link persistence keeps a typed example.com link removed after saving and opening the editor again (protocol=false)',
      'composer link persistence keeps a imported example.com link removed after saving and opening the editor again (protocol=false)',
      'composer link persistence keeps a imported example.com link removed after saving and opening the editor again (protocol=true)',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/links/linksPlugin.ts',
    anchor: 'function $matchAndCreateAutoLink',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/links/linksPlugin.test.ts',
    cases: [
      'composer link persistence keeps escaped URLs literal when imported into a live editor',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin.ts',
    anchor: 'function registerNodeTransform',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin.test.ts',
    cases: [
      'block formatting selection boundaries applies quote with backward=false, endAtBlockStart=false',
      'block formatting selection boundaries applies heading1 with backward=false, endAtBlockStart=false',
      'block formatting selection boundaries applies quote with backward=false, endAtBlockStart=true',
      'block formatting selection boundaries applies heading1 with backward=false, endAtBlockStart=true',
      'block formatting selection boundaries applies quote with backward=true, endAtBlockStart=false',
      'block formatting selection boundaries applies heading1 with backward=true, endAtBlockStart=false',
      'block formatting selection boundaries applies quote with backward=true, endAtBlockStart=true',
      'block formatting selection boundaries applies heading1 with backward=true, endAtBlockStart=true',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/keyboard-shortcuts/keyboardShortcutsPlugin.ts',
    anchor: 'function registerKeyboardShortcutsPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/keyboard-shortcuts/keyboardShortcutsPlugin.test.ts',
    cases: [
      'keyboardShortcutsPlugin right arrow escapes inline code and inserts a trailing space',
      'keyboardShortcutsPlugin right arrow escapes inline code and moves past an existing trailing space',
      'keyboardShortcutsPlugin right arrow inserts a space when the caret is at the start of text after inline code',
      'keyboardShortcutsPlugin right arrow moves past a space from an element boundary after inline code',
      'keyboardShortcutsPlugin right arrow inserts a space when selection format is clear at the end of inline code',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/block-decorator-navigation/blockDecoratorNavigationPlugin.ts',
    anchor: 'function $stopOnBlock',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/block-decorator-navigation/blockDecoratorNavigationPlugin.test.ts',
    cases: [
      'arrow keys across a database answer ArrowDown selects the answer, then moves below it',
      'arrow keys across a database answer ArrowUp selects the answer, then moves above it',
      'arrow keys across a database answer ArrowDown from a line with more text below it does not select the answer',
      'arrow keys across a database answer ArrowDown from a caret between blocks on the root selects the answer below it',
      'arrow keys across a database answer ArrowUp from a caret between blocks on the root selects the answer above it',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/block-decorator-navigation/blockDecoratorNavigationPlugin.ts',
    anchor: 'export function $selectDocumentStart',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/block-decorator-navigation/blockDecoratorNavigationPlugin.test.ts',
    cases: [
      'arrow keys across a database answer entering the document from above selects an answer that opens it',
      'arrow keys across a database answer entering the document from above puts the caret at the start of its first line',
    ],
  },
] as const;
