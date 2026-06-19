## Lock on

**`$byId(s, id): LexicalNode`**: any node by id.
```ts
$byId(s, 'b2').remove()
```

**`$blockById(s, id): ElementNode`**: block by id; resolves up from inline nodes.
```ts
$blockById(s, 'b1').getChildren()
```

**`$allById(s, ids): LexicalNode[]`**: several ids at once.
```ts
$allById(s, ['b2', 'b3'])
```

## Read / query

**`$getText(node): string`**: plain text of a node.
```ts
$getText($blockById(s, 'b2'))
```

## Blocks

**`$modifyNode(s, idOrNode, change): LexicalNode`**: in-place modifier; keeps the node's id. `change`:
- `{ op: 'blockType', block: 'paragraph'|'heading'|'quote'|'code', level? }`
- `{ op: 'text', text }` — rewrite inline content as plain text (no markdown parsing)
- `{ op: 'listType', list: 'bullet'|'number'|'check' }` — retype the enclosing list
- `{ op: 'checked', checked }` — check / uncheck a list item
- `{ op: 'indent', indent: 'in'|'out'|number }` — list-item nesting
```ts
$modifyNode(s, 'b14', { op: 'blockType', block: 'heading', level: 2 })
// in    Notes {b14}
// out   ## Notes {b14}

$modifyNode(s, 'b2', { op: 'text', text: 'The launch is behind schedule.' })
// in    ok so the launch is kinda behind {b2}
// out   The launch is behind schedule. {b2}

$modifyNode(s, 'i9', { op: 'listType', list: 'number' })
// in    - item one {i9}  - item two {i10}
// out   1. item one {i9}  2. item two {i10}

$modifyNode(s, 'n1', { op: 'checked', checked: true })
// in    - [ ] send recap {n1}
// out   - [x] send recap {n1}

$modifyNode(s, 'b16', { op: 'indent', indent: 'in' })
// in    - top level {b16}
// out     - top level {b16}
```

**`$setText(block, text): void`**: rewrite a block's inline content as plain text, keeping its type and id. For rich inline content (bold, italic, etc.) build nodes explicitly instead.
```ts
$setText($blockById(s, 'b2'), 'The launch is behind schedule.')
// in    ok so the launch is kinda behind {b2}
// out   The launch is behind schedule. {b2}
```

**`$replaceBlock(block, ...nodes): ElementNode[]`**: replace a block with pre-built node(s).
```ts
const h2 = $createHeadingNode('h2'); h2.append($createTextNode('Status'))
const p = $createParagraphNode(); p.append($createTextNode('Behind schedule.'))
$replaceBlock($blockById(s, 'b2'), h2, p)
// in    ok so the launch is kinda behind {b2}
// out   ## Status {n1}
//       Behind schedule. {n2}
```

**`$insertAfter(block, ...nodes): ElementNode[]`**: insert pre-built block node(s) after a block.
```ts
const h2 = $createHeadingNode('h2'); h2.append($createTextNode('Recommendation'))
const p = $createParagraphNode(); p.append($createTextNode('Ship next week.'))
$insertAfter($blockById(s, 'b7'), h2, p)
// in    - Documentation {b7}
// out   - Documentation {b7}
//       ## Recommendation {n1}
//       Ship next week. {n2}
```

**`$insertBefore(block, ...nodes): ElementNode[]`**: insert pre-built block node(s) before a block.
```ts
const h2 = $createHeadingNode('h2'); h2.append($createTextNode('TL;DR'))
const p = $createParagraphNode(); p.append($createTextNode('Shipping next week.'))
$insertBefore($blockById(s, 'b1'), h2, p)
// in    # Meeting Notes {b1}
// out   ## TL;DR {n1}
//       Shipping next week. {n2}
//       # Meeting Notes {b1}
```

**`$appendBlock(s, ...nodes): ElementNode[]`**: append pre-built block node(s) at the end of the doc.
```ts
const h2 = $createHeadingNode('h2'); h2.append($createTextNode('Notes'))
const p = $createParagraphNode(); p.append($createTextNode('Follow up Friday.'))
$appendBlock(s, h2, p)
// in    ... need to finalize pricing {b16}
// out   ... need to finalize pricing {b16}
//       ## Notes {n1}
//       Follow up Friday. {n2}
```

**`$prependBlock(s, ...nodes): ElementNode[]`**: prepend pre-built block node(s) at the top of the doc.
```ts
const h1 = $createHeadingNode('h1'); h1.append($createTextNode('Title'))
$prependBlock(s, h1)
// in    attendees: wolf, sara {b2}
// out   # Title {n1}
//       attendees: wolf, sara {b2}
```

**`$moveBlock(block, to): void`**: relocate a block. `to`: `{ afterId? | beforeId? }`.
```ts
$moveBlock($byId(s, 'b16'), { afterId: 'b6' })
// in    ## Decisions {b6}  /  ...  /  need to finalize pricing {b16}
// out   ## Decisions {b6}  /  need to finalize pricing {b16}  /  ...
```

**`$mergeBlocks(blocks, separator?): ElementNode`**: merge into the first block (default separator `' '`).
```ts
$mergeBlocks($allById(s, ['b2', 'b3']))
// in    We were behind. {b2}  /  QA hadn't started. {b3}
// out   We were behind. QA hadn't started. {b2}
```

**`$splitBlock(block, atText): [ElementNode, ElementNode]`**: split a block at `atText`.
```ts
$splitBlock($blockById(s, 'b8'), 'Second,')
// in    First, we shipped. Second, we tested. {b8}
// out   First, we shipped. {b8}  /  Second, we tested. {n1}
```

**`block.remove(): void`**: delete a block.
```ts
$byId(s, 'b9').remove()
// in    duplicate filler {b9}
// out   (removed)
```

## Inline

`Scope`: `{ nth? }` one occurrence, `{ all: true }` every one. Returns count changed.

**`$createTextNode(text).toggleFormat('bold')`**: build a formatted inline node.

**`$replaceTextInBlock(block, needle, make, scope?): number`**: replace matches with constructed node(s).
```ts
$replaceTextInBlock($blockById(s, 'b5'), 'frog',
  () => $createTextNode('toad').toggleFormat('bold'), { all: true })
```

**`$formatTextInBlock(block, needle, format, scope?): number`**: format a substring. `format`: `bold|italic|underline|strike|code`.
```ts
$formatTextInBlock($blockById(s, 'b5'), 'Bluejay', 'bold', { all: true })
```

**`$setAllFormat(block, format?): void`**: apply `format` to every text node in a block, or omit `format` to strip all formatting. `format`: `bold|italic|underline|strike|code`.

**`$clearFormat(block, needle, format?, scope?): number`**: remove formatting from a matched substring (omit `format` to clear all formats on that substring).
```ts
$clearFormat($blockById(s, 'b5'), 'Bluejay', 'bold', { all: true })
```

**`$replaceString(block, find, replace, scope?): number`**: literal text replace within one block.
```ts
$replaceString($blockById(s, 'b5'), 'Q3', 'Q4', { all: true })
```

**`$appendText(block, text): void`**: add text to the end of a block.
```ts
$appendText($blockById(s, 'b1'), ' (draft)')
```

**`$prependText(block, text): void`**: add text to the start of a block.
```ts
$prependText($blockById(s, 'b1'), 'DRAFT: ')
```

## Lists

**`$toggleList(blocks, type): ListNode`**: wrap plain blocks (paragraphs) into a NEW list. `type`: `bullet|number|check`. To retype an existing list, or check/indent its items, use `$modifyNode`.
```ts
$toggleList($allById(s, ['b11', 'b12']), 'check')
```

**`$sortList(node, { order? }): void`**: sort the list enclosing `node` alphabetically. `order`: `asc` (default) | `desc`.
```ts
$sortList($byId(s, 'b16'))
```

## Tables

Build/edit as nodes; they read back as pipe markdown. Never pass `| a | b |` as a string — it stays literal text.

**`$table(rows): TableNode`**: 2D array of cells (each a string, or a node for rich content). First row is the header.
```ts
$blockById(s, 'b7').insertAfter($table([['Fruit', 'Taste'], ['Apple', 'Sweet']]))
$byId(s, 'tableId').replace($table(rows))   // rebuild a whole table
```

**`$setCell(node, row, col, content): void`**: set one cell in place — 0-based, header is row 0, `content` is a string or node.
```ts
$setCell($byId(s, 'tableId'), 1, 0, 'Banana')
```

## Custom & special nodes

Build these with their creator, then place with `$insertAfter` / `$insertBefore` / `$appendBlock` / `$prependBlock` (block nodes) or append into a block / `$replaceTextInBlock` (inline nodes).

**`$createHorizontalRuleNode(): HorizontalRuleNode`** — a divider/rule block.
```ts
$insertAfter($blockById(s, 'b3'), $createHorizontalRuleNode())
// out   ... {b3}  /  --- {n1}  /  ...
```

**`$createEquationNode(equation, inline?): EquationNode`** — a math (KaTeX) node. `inline` defaults to `false` (own block); pass `true` to sit within a line of text. `equation` is the LaTeX string.
```ts
$appendBlock(s, (() => { const p = $createParagraphNode(); p.append($createEquationNode('e=mc^2', true)); return p; })())
const block = $createParagraphNode(); block.append($createEquationNode('\\int_0^1 x^2 dx'))
$insertAfter($blockById(s, 'b3'), block)
```

**`$createImageNode({ srcType, url?, id?, alt?, width?, height?, scale? }): ImageNode`** — an image block. For an image from a public URL use `srcType: 'url'` with `url`. (`srcType: 'sfs'` is a file already in the file service and needs a real file `id` — do NOT invent one.)
```ts
$insertAfter($blockById(s, 'b3'), $createImageNode({ srcType: 'url', url: 'https://example.com/cat.png', alt: 'a cat' }))
```

**`$createVideoNode({ srcType, url?, id?, controls?, width?, height?, scale? }): VideoNode`** — a video block. Same `srcType` rules as image.
```ts
$insertAfter($blockById(s, 'b3'), $createVideoNode({ srcType: 'url', url: 'https://example.com/clip.mp4' }))
```

**`$createDateMentionNode({ date, displayFormat, mentionUuid? }): DateMentionNode`** — an inline date chip. `date` is ISO (`2026-06-18T00:00:00.000Z`), `displayFormat` is the shown text (e.g. `june 18`).
```ts
$appendText($blockById(s, 'b1'), ' due ')
$blockById(s, 'b1').append($createDateMentionNode({ date: '2026-06-18T00:00:00.000Z', displayFormat: 'june 18' }))
```

**`$createLineBreakNode(): LineBreakNode`** — a soft line break (Shift+Enter) *inside* a block; append it between text nodes. To make separate blocks, build separate paragraphs instead.
```ts
const p = $createParagraphNode()
p.append($createTextNode('line one'), $createLineBreakNode(), $createTextNode('line two'))
$insertAfter($blockById(s, 'b3'), p)
```

**`$createTabNode(): TabNode`** — a tab character; append inline like a text node.

> Mentions that point at real entities — `user-mention`, `document-mention`, `contact-mention`, `group-mention`, `theme-mention` — and `document-card` require backend ids (`userId`, `documentId`, `mentionUuid`, …) that cannot be invented. There is no creator for them here; do not fabricate one. If a request needs one, say it requires data this editor doesn't have.
