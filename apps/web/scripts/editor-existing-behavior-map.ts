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
  {
    source: 'packages/lexical-core/node-list.ts',
    anchor: 'replace: ListNode,',
    testFile: 'packages/lexical-core/tests/list-transformers.test.ts',
    cases: [
      'custom ordered-list transformer keeps a non-1 start when replacing ListNode with TaskListNode',
    ],
  },
  {
    source: 'packages/lexical-core/transformers/customTransformers.ts',
    anchor: 'const customTransformer =',
    testFile: 'packages/lexical-core/tests/list-transformers.test.ts',
    cases: [
      'custom ordered-list transformer starts a new list at the typed marker',
      'custom ordered-list transformer uses the incoming marker as the start when inserting before an ordered list',
    ],
  },
  {
    source: 'packages/lexical-core/transformers/customTransformers.ts',
    anchor: 'export const ORDERED_LIST_ENTER',
    testFile: 'packages/lexical-core/tests/list-transformers.test.ts',
    cases: [
      'custom ordered-list transformer starts a list at the typed marker on Enter without a trailing space',
    ],
  },
  {
    source: 'packages/lexical-core/utils/markdown-state.ts',
    anchor: 'export function serializedEditorStateToMarkdown',
    testFile: 'packages/lexical-core/tests/list-transformers.test.ts',
    cases: [
      'custom ordered-list transformer imports and exports a markdown list that starts after 1',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.ts',
    anchor: '      INSERT_DOCUMENT_MENTION_COMMAND,\n      (payload)',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.test.ts',
    cases: [
      'mentionsPlugin inserts a compact database mention and preserves surrounding text',
      'mentionsPlugin tracks a WhatsApp group mention as a external_chat reference',
      'mentionsPlugin keeps database mentions compact in composers',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.ts',
    anchor: '  function databaseReferenceRemains',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.test.ts',
    cases: [
      'mentionsPlugin keeps the tracked database reference through collapse/expand and untracks only its removal',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.ts',
    anchor: '      DocumentMentionNode,\n      (mutatedNodes',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.test.ts',
    cases: [
      'mentionsPlugin sends an inline form mention as a form reference, and drops it when the mention is removed',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.ts',
    anchor: '      DocumentCardNode,\n      (mutatedNodes',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.test.ts',
    cases: [
      'mentionsPlugin reports a document card put into a composer as a reference, and its removal',
      'mentionsPlugin keeps a mention referenced when it turns into a card',
      'mentionsPlugin leaves other cards\u2019 sharing as it was: only form cards are references here',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/find-and-replace/findAndReplacePlugin.ts',
    anchor: 'function findMatchOffsets',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/find-and-replace/findAndReplacePlugin.test.ts',
    cases: [
      'findAndReplacePlugin mention chips finds a substring in an inline task chip title',
      'findAndReplacePlugin mention chips still finds regular paragraph text next to a task chip',
      'findAndReplacePlugin mention chips finds a user mention display name',
      'findAndReplacePlugin mention chips finds a group mention alias',
      'findAndReplacePlugin mention chips finds a contact mention name',
      'findAndReplacePlugin multi-line blocks finds text inside a code block',
      'findAndReplacePlugin multi-line blocks finds text after a code block',
      'findAndReplacePlugin multi-line blocks numbers every match in document order',
      'findAndReplacePlugin multi-line blocks splits a match across formatted text nodes',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/find-and-replace/findAndReplacePlugin.ts',
    anchor: 'function pairKeysWithNonTextNodes',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/find-and-replace/findAndReplacePlugin.test.ts',
    cases: [
      'findAndReplacePlugin mention chips does not delete text beside a mention when replace spans both',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/find-and-replace/findAndReplacePlugin.ts',
    anchor: 'function collectTextSegments',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/find-and-replace/findAndReplacePlugin.test.ts',
    cases: [
      'findAndReplacePlugin multi-line blocks does not match across block boundaries',
      'findAndReplacePlugin nested blocks separates inline text from a block nested after it',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/comments/commentPlugin.ts',
    anchor: '  const $selectMarksAtCaret =',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/comments/commentPlugin.test.ts',
    cases: [
      'commentPlugin selects the comment under an unmoved caret again when the editor is clicked',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/listItemImages.ts',
    anchor: 'export function $insertImageIntoListItem',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/listItemImages.test.ts',
    cases: [
      'images in lists puts an image under the item the caret is in without splitting the list',
      'images in lists attaches an image on the empty item Enter left to the item above, and a second Enter still leaves the list',
      'images in lists leaves an image outside a list when the caret is not in one',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/listItemImages.ts',
    anchor: 'function $insertParagraphAboveImages',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/listItemImages.test.ts',
    cases: ['images in lists starts the next item below the images on Enter'],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.ts',
    anchor: 'function $staticUploadSuccess',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.test.ts',
    cases: [
      'points a pasted image at its static file once the upload finishes',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.ts',
    anchor: '  const followCreatedLocalMedia =',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.test.ts',
    cases: [
      'gives a copy pasted into another editor mid-upload the same static file',
      'gives a copy pasted into a chat editor, which has no video nodes, the same static file',
      'points an image deleted mid-upload and restored by undo at its static file',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.ts',
    anchor: '  const uploadFile = async',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.test.ts',
    cases: ['uploads a file pasted twice once and points both images at it'],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.ts',
    anchor: '  const followUpload = async',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/media/mediaPlugin.test.ts',
    cases: ['tells every image waiting on a failed upload that it failed'],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/createMentionPageLoader.ts',
    anchor: 'export function createMentionPageLoader',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/createMentionPageLoader.test.ts',
    cases: [
      'does not turn a bounded empty/duplicate scan into an automatic loading loop',
      'allows another automatic load after leaving or changing category',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/MarkdownImage.tsx',
    anchor: '  const persistScale = debounce',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/MediaReadonly.test.tsx',
    cases: [
      'stops active and debounced image resizing on lock while preserving committed size',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/MarkdownVideo.tsx',
    anchor: '  const persistScale = debounce',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/MediaReadonly.test.tsx',
    cases: [
      'stops active and debounced video resizing on lock while preserving committed size',
    ],
  },
  // Comment transport, publication and layout observers are boundary stubs.
  // These rows pin editor/state lifecycle, not remote delivery or thread UI.
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/comments/commentPlugin.ts',
    anchor: '      DELETE_COMMENT_COMMAND,\n      ([markId',
    testFile:
      'apps/web/src/features/block-md/comments/commentMarkRemoval.test.ts',
    cases: [
      'comment mark removal can clean a server-deleted mark during discovery (already mounted: false)',
      'comment mark removal can clean a server-deleted mark during discovery (already mounted: true)',
      'comment mark removal deletes only the requested thread when comments overlap',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/comments/commentPlugin.ts',
    anchor: '    editor.registerMutationListener(\n      CommentNode,',
    testFile:
      'apps/web/src/features/block-md/comments/commentMarkRemoval.test.ts',
    cases: [
      'comment mark removal reports the last removed range, including a collaborator edit',
      'comment mark removal reports deletion of all selected marked text',
      'comment mark removal keeps a thread anchored while another range with its ID exists',
      'comment mark removal does not mistake node replacement in one update for range deletion',
      'comment mark removal does not infer deletion from initialization or view unmounting',
    ],
  },
  {
    source: 'packages/lexical-core/nodes/CommentNode.ts',
    anchor: 'export function stripDraftCommentMarks',
    testFile:
      'apps/web/src/features/block-md/comments/draftCommentMarkSync.test.ts',
    cases: [
      'draft comment marks stay out of the shared document leaves the draft out of the synced and saved state but keeps its text',
      'draft comment marks stay out of the shared document keeps committed comment marks in the synced state',
      'draft comment marks stay out of the shared document returns the same state object when there is no draft to strip',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/comments/commentPlugin.ts',
    anchor: '      DELETE_COMMENT_COMMAND,\n      ([markId',
    testFile:
      'apps/web/src/features/block-md/comments/draftCommentMarkSync.test.ts',
    cases: [
      'draft comment marks stay out of the shared document preserves a saved range when an overlapping draft is cancel',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/comments/commentPlugin.ts',
    anchor: '      COMMIT_COMMENT_MARK_COMMAND,\n      ({ markId',
    testFile:
      'apps/web/src/features/block-md/comments/draftCommentMarkSync.test.ts',
    cases: [
      'draft comment marks stay out of the shared document preserves a saved range when an overlapping draft is commit',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/collaboration/reconcile.ts',
    anchor: 'export function $reconcileLexicalState',
    testFile:
      'apps/web/src/features/block-md/comments/draftCommentMarkSync.test.ts',
    cases: [
      'draft comment marks stay out of the shared document preserves a saved range when an overlapping draft is remote',
      'draft comment marks stay out of the shared document keeps the local draft mark node through a remote edit elsewhere',
      'draft comment marks stay out of the shared document keeps the draft over its text when a peer edits that text',
      'draft comment marks stay out of the shared document drops the draft when a peer deletes all of its text',
      'draft comment marks stay out of the shared document strips drafts that a previous session left in the shared state',
    ],
  },
  {
    source: 'apps/web/src/lib/core/component/LexicalMarkdown/utils.ts',
    anchor: 'export function initializeEditorWithState(',
    testFile:
      'apps/web/src/features/block-md/comments/draftCommentMarkSync.test.ts',
    cases: [
      'draft comment marks stay out of the shared document does not load drafts saved in a document',
    ],
  },
  {
    source:
      'apps/web/src/features/block-md/comments/messageCommentOperations.ts',
    anchor: 'export function useCreateMessageComment',
    testFile:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.test.tsx',
    cases: [
      'inline comment link navigation keeps the draft and posts no message when its anchor is not acknowledged',
      'inline comment link navigation does not post or clear a newer draft when an abandoned publication finishes',
      'inline comment link navigation opens another comment after posting, metadata first: false',
      'inline comment link navigation opens another comment after posting, metadata first: true',
    ],
  },
  {
    source: 'apps/web/src/features/block-md/comments/LocalCommentDraft.tsx',
    anchor: '        post: async (send) => {',
    testFile:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.test.tsx',
    cases: [
      'inline comment link navigation handles cancellation after message failure, outcome uncertain: false',
      'inline comment link navigation handles cancellation after message failure, outcome uncertain: true',
    ],
  },
  {
    source:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.tsx',
    anchor: '  const localDraft = createLocalCommentDraft({',
    testFile:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.test.tsx',
    cases: [
      'inline comment link navigation opens a new draft inside an existing comment and preserves that comment on cancellation',
      'inline comment link navigation opens and cancels a draft (editor published after mounting: false)',
      'inline comment link navigation opens and cancels a draft (editor published after mounting: true)',
    ],
  },
  {
    source: 'apps/web/src/features/block-md/comments/LocalCommentDraft.tsx',
    anchor: '    create: (id: string, selection: RangeSelection) => {',
    testFile:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.test.tsx',
    cases: [
      'inline comment link navigation keeps a draft spanning paragraphs outside the document tree',
    ],
  },
  {
    source:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.tsx',
    anchor: '    const rawComment = props.activeComment?.() ?? undefined;',
    testFile:
      'apps/web/src/features/block-md/comments/MessageCommentsProvider.test.tsx',
    cases: [
      'inline comment link navigation waits for editor initialization even when comments and marks arrive first',
      'inline comment link navigation waits for comment data when the editor loads first',
      'inline comment link navigation keeps the navigation pending while the editor is detached',
    ],
  },
  // Search data is supplied at the query/cache boundary; these do not
  // establish service-backed menu UI or remote search delivery.
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useUsersMention.ts',
    anchor: 'export function useUsersMention(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useUsersMention.test.ts',
    cases: [
      'ranks shared people identically in body and discussion mention searches',
      'keeps custom participant scope and display data when workspace data refreshes',
      'uses supplied interaction history for people absent from the workspace list',
      'preserves explicitly empty participant lists',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useUsersMention.ts',
    anchor: '  const groups = (): GroupMentionItem[] => {',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useUsersMention.test.ts',
    cases: [
      'offers @here to channel composers without a block context',
      'keeps @here out of composers that do not post to a channel',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEntityMention.ts',
    anchor: 'export function useEntityMention(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEntityMention.test.ts',
    cases: [
      'exposes pagination from search projections, not just legacy record selection',
      'ranks local projects together with cached hits and reranks new pages',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useCalendarEventMention.ts',
    anchor: 'export function calendarEventMentionItems(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useCalendarEventMention.test.ts',
    cases: [
      'offers each event once, pinned to its occurrence only when it repeats',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useCalendarEventMention.ts',
    anchor: '  const events = createLazyMemo',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useCalendarEventMention.test.ts',
    cases: [
      'keeps the found events when a later search fails, and waits for the first one',
      'lists events shared with your channels after your own, in their order',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenuController.ts',
    anchor: '  bins = createLazyMemo',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenuController.test.ts',
    cases: [
      'keeps the same people visible and selected as delayed categories arrive',
      'keeps document preview slots stable when only total match counts change',
      'allocates unused people slots to other categories and excludes ignored people',
      'retains the full combined mobile list and entity-only allocation',
      'keeps every category reachable when stable People rows exceed the preview target',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenuController.ts',
    anchor: '  viewAll(bucketId: string): void {',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenuController.test.ts',
    cases: [
      'keeps all people accessible through View all and keyboard navigation',
    ],
  },
  // Cleanup uses an in-memory WAL and supplied removal results. Layout
  // geometry/observers and margin Thread content are boundary fixtures;
  // these rows do not prove native geometry or full thread UI.
  {
    source: 'apps/web/src/features/block-md/comments/commentMarkCleanup.ts',
    anchor: 'export function createCommentMarkCleanup(',
    testFile:
      'apps/web/src/features/block-md/comments/commentMarkCleanup.test.ts',
    cases: [
      'keeps failed removals for a new drain without retrying successful entries',
      'retains intents when lookup or transport throws',
      'continues after a rejected lookup without losing its cleanup intent',
      'drains an intent appended while another removal is pending',
      'retries a reconnect that arrives during a failed attempt, throws: false',
      'retries a reconnect that arrives during a failed attempt, throws: true',
    ],
  },
  {
    source: 'apps/web/src/features/block-md/comments/commentLayout.ts',
    anchor: 'export function createCommentLayout()',
    testFile: 'apps/web/src/features/block-md/comments/commentLayout.test.tsx',
    cases: [
      'comment layout during document reflow keeps comments beside their text through consecutive margin resize events',
      'comment layout during document reflow keeps comments beside their text through consecutive editor resize events',
      'comment layout during document reflow keeps comments beside their text through consecutive internal layout shift events',
    ],
  },
  {
    source: 'apps/web/src/features/block-md/comments/commentLayout.ts',
    anchor: 'export function stackMarginThreads<T>(',
    testFile: 'apps/web/src/features/block-md/comments/commentLayout.test.tsx',
    cases: [
      'stacking margin threads keeps each thread beside its mark when they fit',
      'stacking margin threads pushes the threads below a tall active thread past its end',
      'stacking margin threads never stacks a thread above the top of a short page',
      'stacking margin threads moves the active thread up only to end inside the page',
    ],
  },
  {
    source: 'apps/web/src/features/block-md/comments/CommentMargin.tsx',
    anchor: '    const onPointerDown = (e: PointerEvent) => {',
    testFile: 'apps/web/src/features/block-md/comments/CommentMargin.test.tsx',
    cases: [
      'CommentMargin closes a thread opened from its card when a press lands outside the comments',
      'CommentMargin keeps the thread open for presses on the editor, the card, and the layers it opened',
      'CommentMargin releases a thread highlighted by the caret when a press lands outside',
      'CommentMargin leaves a draft comment open',
    ],
  },
  // Native IPC/platform responses and file size metadata are supplied;
  // these cases do not execute native pasteboard staging or uploads.
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/file-paste/desktopPasteboardFiles.ts',
    anchor: 'export function shouldStageDesktopPasteFiles(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/file-paste/desktopPasteboardFiles.test.ts',
    cases: [
      'desktop pasted files stages only when a desktop paste carries a large file',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/file-paste/desktopPasteboardFiles.ts',
    anchor: 'export async function stageDesktopPasteFiles(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/file-paste/desktopPasteboardFiles.test.ts',
    cases: [
      'desktop pasted files tags pasted files matching the staged pasteboard files',
      'desktop pasted files falls back to browser files when staging fails',
    ],
  },
] as const;
