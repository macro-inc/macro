// Human-reviewed behavior groups. The AST ledger beneath each group retains
// individual commands, guards, event handlers and source locations.
export const EDITOR_PLUGIN_BEHAVIORS: Record<string, string> = {
  actions:
    'Slash menu: whitespace/boundary trigger, search updates, collapse/remove, Escape, Enter interception; available actions depend on host and registered nodes.',
  'agent-commands':
    'Agent slash commands: positional trigger, filtering, menu lifecycle, selected command insertion and description/prompt routing.',
  await:
    'Insert inline/block loading placeholder; preserve expanded selection; replace the matching ID with one/many/no nodes; ignore deleted or unknown placeholders; restore caret.',
  'blame-tooltip':
    'Show author/peer information at hovered text; position the tooltip and remove hover listeners on root replacement/disposal.',
  'block-decorator-navigation':
    'Arrow and Backspace navigation across block decorators, empty boundary paragraphs, node/range selection, and read-only guards.',
  'checkbox-to-task':
    'Parse selected checklist metadata; create tasks in parallel, batch-replace successful items with task mentions, ignore missing replacement nodes and report per-item failures/completion.',
  checklist:
    'Insert check lists; pointer hit target, editable/editor identity checks and five-pixel drag threshold; platform modifier+Enter aligns all selected checks with the first; remove checkbox tab stops.',
  'checklist-controls':
    'Collect checklist/task metadata; filter, group, collapse groups and show progress; persist view settings on nodes; synchronize portal mounts; upgrade plain imported list nodes.',
  code: 'Insert highlighted code; language picker/accessory; select-all scopes, Tab indentation, line movement and boundary exits; distinguish collapsed/ranged selections.',
  comments:
    'Wrap/unwrap selected text with comment marks; activate marked threads including caret boundaries; publish mark add/remove lifecycle, local/draft/server-thread state and shared peer changes. Comment-only authorization requires host coverage.',
  'custom-caret':
    'Inactive source: private custom-cursor prototype is not exported or installed; do not count as current mounted behavior.',
  'custom-delete':
    'Character, word and line deletion at the collapsed start of a list item turn it into a paragraph; yield for ranges, non-list nodes and other offsets.',
  diff: 'Critical-priority delete handling at diff-node boundaries preserves tracked-change semantics.',
  'document-metadata':
    'Read/import document metadata, upgrade old document versions without a separate undo step, and report versions newer than the supported counter.',
  'drag-insert':
    'Drag/drop files and entities into the editor; compute insertion position, split lists, show target indicator, and clear drag state.',
  'draggable-block':
    'Hover block handles; select/serialize dragged blocks; reorder within/between lists and tables; calculate drop geometry and keep touch/read-only guards.',
  'element-event':
    'Inactive source: private generic element-event prototype is not exported; root listener replacement and guarded ancestor lookup remain source obligations.',
  emojis:
    'Colon trigger at valid positions; inline search/menu lifecycle; Escape collapses, remove command deletes, Enter stays with open menu; peer-owned search protection.',
  'file-paste':
    'Clipboard files/directories; prefer directories to phantom duplicate files; stage native desktop pasteboard files; recover mobile image clipboard; async callback/fallback and default prevention.',
  'find-and-replace':
    'Literal escaped search across inline nodes but never block boundaries; include mention labels, ignore equations/dividers/media boundaries; replace once/all with offsets and selection.',
  generate:
    'Collect selection context; create completion preview nodes; intercept Enter/Tab/Space while generated content waits; accept or reject completions, clear generation/menu signals and refresh accessories.',
  gif: 'Search/pick GIF; insert asynchronous media placeholder, upload and replace; preserve sizing, failures and disposed/deleted targets.',
  'horizontal-rules':
    'Insert divider at selection; split lists at the insertion boundary; retain the lone empty paragraph as a caret landing target.',
  'insert-text':
    'Insert text at range/root selection, wrap a root insertion in a paragraph and put the caret after the new text.',
  'ios-cursor-scroll':
    'Keep the caret fifty pixels above keyboard/visual viewport boundary; react to keyboard visibility and editor updates; cancel scheduled frame work at disposal.',
  katex:
    'Selection-gated equation picker; insert inline/block equation and wrap root inline nodes; update valid equation keys; reject empty/unknown/wrong-node updates; edit callback.',
  'keyboard-focus':
    'Host start/end focus callbacks for Tab/ShiftTab and arrows; collapsed boundary selection only, code excluded; typeahead can consume navigation.',
  'keyboard-shortcuts':
    'Mac Meta versus other Ctrl; strike, code, highlight and list/quote shortcuts with priority ordering; ArrowRight escapes code/highlight/strike and reuses or inserts a plain space.',
  links:
    'Protocol/common-TLD auto-linking; incomplete/email boundary rules; normalized safe URLs; selection link/unlink, explicit unlink markers, link editing/hover/open interactions.',
  'list-swipe-indent':
    'Touch horizontal swipes indent/outdent list items with axis/threshold checks; preserve scrolling, native input, selection and read-only behavior.',
  location:
    'Serialize/parse selection locations and location URLs; resolve stable IDs through cached mapping or live breadth-first scan; scroll/highlight nodes, retry after DOM reconciliation, and revoke locations on mutation/selection/timeout.',
  'markdown-paste':
    'Shift bypass; Lexical/HTML MIME precedence over plain Markdown; parse plain text with only target nodes; preserve all-quote selections when inserting multiple paragraphs.',
  'markdown-shortcuts':
    'Live Markdown transforms excluding conversion-only or unsupported-node transforms; Enter on divider/code/ordered marker; first-child paragraph checks and range behavior.',
  media:
    'Insert/update/delete/resize images and video; URL/file/drag source handling, upload placeholders and list-image placement; accessories and pending/error lifecycle.',
  mentions:
    'At-sign boundary trigger; user/group/entity/document/card/agent/contact/date/booking/tag/theme mentions; convert cards; callbacks and tracking; peer-owned search lifecycle.',
  'native-ios-backspace':
    'Native iOS beforeinput delete routing at contenteditable boundaries; distinguish composition, selection, platform and native wrapper state.',
  'node-accessory':
    'Populate accessory-store entries for created node keys and remove destroyed keys; force-refresh requested existing accessories by clearing/restoring entries.',
  'node-transform':
    'Paragraph/heading/quote/code/link/list block transforms; reject missing dependencies and non-range selections; normalize a copy of backward selection to include first block.',
  'normalize-enter':
    'Split headings into paragraphs; insert before headings/quotes at start; exit empty quote/heading; clear pending formatting in empty paragraphs; modified Enter and Shift+Enter handling.',
  'normalize-triple-click':
    'Normalize triple-click paragraph selections from classic rich-text registration without changing ordinary pointer selections.',
  'pinned-properties':
    'Persist pinned property ID arrays in root NodeState; add without duplicates, remove IDs, filter invalid serialized members, and distinguish untouched defaults from an explicitly saved empty list.',
  popup:
    'Selection popup for range/table selections and allowed collapsed comment ranges; selection rectangles, touch handling, highlighted nodes and Markdown replacement.',
  progress:
    'Count checked/total nonempty checklist leaf items; skip nested-list wrappers and non-checklist rows; publish progress statistics after updates and remove the update subscription at cleanup.',
  'restore-focus':
    'Remember selection on blur, restore on refocus, and avoid restoring a stale/foreign selection after root or editor changes.',
  'selection-data':
    'Publish selected formats/block/link/code/list state to toolbar/composer controls; reflect selection, editability and node mutations.',
  'single-line':
    'Titles retain first root block, drop line breaks and unwrap nested pasted/snippet paragraphs while retaining inline formatting.',
  skills:
    'AI slash skill/connection/pull-request menu at valid positions; search lifecycle, keyboard interception, insertion and peer ownership.',
  snippets:
    'Semicolon feature/position gating; filter/select snippet; prevent self-insertion; async placeholder replacement, empty/failure cleanup and single history group.',
  'tab-indentation':
    'Tab/ShiftTab dispatch indent/outdent; paragraphs indent at most one level beyond previous sibling; no code/quote/heading indentation; deduplicate selected blocks.',
  tables:
    'Insert/pick/resize tables; row/column actions, headers, merge/background constraints; selection/clear/delete; Tab grows last row while list Tab wins; select-all scoping and touch drag guards.',
  tags: 'Hash boundary trigger; insert inline tag or host-only callback; deduplicate serialized tag set and creation/removal lifecycle; collapse/remove/peer ownership.',
  'text-paste':
    'Recognize app/GitHub pull-request links; selected-text link insertion, internal mentions, theme links; preserve literal text in code and yield on unsupported clipboards.',
  'trailing-paragraph':
    'Append editable paragraph after terminal block decorator/code/table; create paragraph in clicked gap between such blocks with history push; read-only/button/target guards.',
  'word-navigation':
    'Non-Apple Ctrl-word movement around leading inline decorators; Firefox offset-zero escape; retain Apple line-edge navigation and code behavior.',
  wordcount:
    'Debounced locale word/character counts for whole document and selection; newline separators; collapsed/no selection produces null selection counts.',
};
