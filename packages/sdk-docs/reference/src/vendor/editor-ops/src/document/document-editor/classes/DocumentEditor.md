# Class: DocumentEditor

Records edits to a document as plain-data `DocumentOp`s without touching the
document. Every method checks its arguments at once and throws `EditError`;
the host applies the whole batch afterwards. Address existing nodes by the
durable ids the document's XML shows; insert methods return the new node's
id, usable later in the same batch.

## Example

```ts
const editor = new DocumentEditor({ validIds: ['h1', 'p1'], refs });
editor.replace('p1', 'Q3', 'Q4').bold('p1', 'Q4');
const heading = editor.insertHeadingAfter('p1', 2, 'Next steps');
const item = editor.insertBlockAfter(heading, {
  block: 'list',
  list: 'check',
  items: ['Ship it'],
});
const ops = editor.drain();
```

## Constructors

### Constructor

> **new DocumentEditor**(`opts`): `DocumentEditor`

Start an empty batch against a document whose node ids are `opts.validIds`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`DocumentEditorOptions`](../type-aliases/DocumentEditorOptions.md) |

#### Returns

`DocumentEditor`

## Methods

### addColumn()

> **addColumn**(`table`, `at?`): `this`

Add an empty column to table `table` at index `at`, or at the end when
omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `at?` | `number` |

#### Returns

`this`

***

### addRow()

> **addRow**(`table`, `at?`): `this`

Add an empty row to table `table` at index `at`, or at the end when
omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `at?` | `number` |

#### Returns

`this`

***

### appendBlock()

> **appendBlock**(`spec`): `string`

Add the block `spec` describes at the end of the document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `spec` | [`NodeSpec`](../../ops/type-aliases/NodeSpec.md) |

#### Returns

`string`

***

### appendDatabaseQuery()

> **appendDatabaseQuery**(`query`): `string`

Add a saved database question at the end of the document as a live number,
table or chart.
`query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
block, verbatim.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` \| [`DatabaseQueryBlock`](../type-aliases/DatabaseQueryBlock.md) |

#### Returns

`string`

***

### appendListItem()

> **appendListItem**(`listId`, `text`): `string`

Add an item with `text` to the end of list `listId` (the `<ul>`/`<ol>` id);
works on an empty list.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `listId` | `string` |
| `text` | `string` |

#### Returns

`string`

***

### appendParagraph()

> **appendParagraph**(`text?`): `string`

Add a paragraph with `text` at the end of the document.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### appendTable()

> **appendTable**(`rows`): `string`

Add a table at the end of the document. `rows[0]` is the
header row; every row needs the same number of cells.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rows` | `string`[][] |

#### Returns

`string`

***

### appendText()

> **appendText**(`id`, `text`): `this`

Add plain text to the end of block `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `text` | `string` |

#### Returns

`this`

***

### bold()

> **bold**(`id`, `match`, `scope?`): `this`

Bold each occurrence of `match` in node `id` (or the one `scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### boldNode()

> **boldNode**(`node`): `this`

Bold all text in node `node`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `node` | `string` |

#### Returns

`this`

***

### bulletList()

> **bulletList**(`idOrIds`): `this`

Turn one block or a run of blocks into a bulleted list, one item per block.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `idOrIds` | `string` \| `string`[] |

#### Returns

`this`

***

### check()

> **check**(`id`): `this`

Check the checklist item `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### checklist()

> **checklist**(`idOrIds`): `this`

Turn one block or a run of blocks into a checklist, one unchecked item per
block.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `idOrIds` | `string` \| `string`[] |

#### Returns

`this`

***

### clearAllFormat()

> **clearAllFormat**(`id`): `this`

Strip all inline formatting from the whole of node `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### clearFormat()

> **clearFormat**(`id`, `match?`, `scope?`): `this`

Strip all inline formatting from occurrences of `match` in node `id`, or
from the whole node when `match` is omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match?` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### clearNodeFormat()

> **clearNodeFormat**(`node`): `this`

Strip all inline formatting from node `node`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `node` | `string` |

#### Returns

`this`

***

### codeNode()

> **codeNode**(`node`): `this`

Format all text in node `node` as inline code.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `node` | `string` |

#### Returns

`this`

***

### convertToCodeBlock()

> **convertToCodeBlock**(`id`, `language`): `this`

Turn block `id` into a code block in `language`, keeping its text. The
block gets a new id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `language` | `string` |

#### Returns

`this`

***

### convertToHeading()

> **convertToHeading**(`id`, `level`): `this`

Turn block `id` into a heading of `level` 1-6, keeping its text. The block
gets a new id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `level` | `number` |

#### Returns

`this`

***

### convertToParagraph()

> **convertToParagraph**(`id`): `this`

Turn block `id` into a paragraph, keeping its text. The block gets a new
id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### convertToQuote()

> **convertToQuote**(`id`): `this`

Turn block `id` into a quote, keeping its text. The block gets a new id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### drain()

> **drain**(): [`DocumentOp`](../../ops/type-aliases/DocumentOp.md)[]

Return the ops recorded so far and start a new batch. The host calls this;
programs don't need to.

#### Returns

[`DocumentOp`](../../ops/type-aliases/DocumentOp.md)[]

***

### format()

> **format**(`id`, `match`, `format`, `on?`, `scope?`): `this`

Turn an inline format on or off for each occurrence of `match` in node
`id`.
`scope` picks one occurrence (`{ kind: 'nth', n }`, 1-based) or all of them
(the default).

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `match` | `string` | `undefined` |
| `format` | [`Format`](../../ops/type-aliases/Format.md) | `undefined` |
| `on?` | `boolean` | `true` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) | `...` |

#### Returns

`this`

***

### formatNode()

> **formatNode**(`node`, `format`, `on?`): `this`

Turn an inline format on or off for all text in node `node`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `node` | `string` | `undefined` |
| `format` | [`Format`](../../ops/type-aliases/Format.md) | `undefined` |
| `on?` | `boolean` | `true` |

#### Returns

`this`

***

### highlight()

> **highlight**(`id`, `match`, `scope?`): `this`

Highlight each occurrence of `match` in node `id` (or the one `scope`
picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### indent()

> **indent**(`id`, `by?`): `this`

Indent block or list item `id` one level; a negative `by` outdents instead.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `by?` | `number` | `1` |

#### Returns

`this`

***

### inlineCode()

> **inlineCode**(`id`, `match`, `scope?`): `this`

Format each occurrence of `match` in node `id` as inline code (or the one
`scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### insertBlockAfter()

> **insertBlockAfter**(`id`, `spec`): `string`

Insert the block `spec` describes after block `id`. Use
for lists, tables, cards and other block kinds.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `spec` | [`NodeSpec`](../../ops/type-aliases/NodeSpec.md) |

#### Returns

`string`

***

### insertBlockBefore()

> **insertBlockBefore**(`id`, `spec`): `string`

Insert the block `spec` describes before block `id`. Use
for lists, tables, cards and other block kinds.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `spec` | [`NodeSpec`](../../ops/type-aliases/NodeSpec.md) |

#### Returns

`string`

***

### insertCodeBlockAfter()

> **insertCodeBlockAfter**(`id`, `language`, `text?`): `string`

Insert a code block in `language` with `text` after block `id`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `language` | `string` | `undefined` |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### insertDatabaseQueryAfter()

> **insertDatabaseQueryAfter**(`id`, `query`): `string`

Insert a saved database question after block `id` as a live number, table
or chart.
`query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
block, verbatim.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `query` | `string` \| [`DatabaseQueryBlock`](../type-aliases/DatabaseQueryBlock.md) |

#### Returns

`string`

***

### insertDatabaseQueryBefore()

> **insertDatabaseQueryBefore**(`id`, `query`): `string`

Insert a saved database question before block `id` as a live number, table
or chart.
`query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
block, verbatim.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `query` | `string` \| [`DatabaseQueryBlock`](../type-aliases/DatabaseQueryBlock.md) |

#### Returns

`string`

***

### insertDate()

> **insertDate**(`blockId`, `at`, `isoDate`, `displayFormat?`): `string`

Insert a date chip for ISO `isoDate` at character offset `at` of block
`blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `isoDate` | `string` |
| `displayFormat?` | `string` |

#### Returns

`string`

***

### insertDivider()

> **insertDivider**(`afterId`): `string`

Insert a horizontal divider after block `afterId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `afterId` | `string` |

#### Returns

`string`

***

### insertEquation()

> **insertEquation**(`afterId`, `tex`): `string`

Insert a block equation with TeX `tex` after block `afterId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `afterId` | `string` |
| `tex` | `string` |

#### Returns

`string`

***

### insertHeadingAfter()

> **insertHeadingAfter**(`id`, `level`, `text?`): `string`

Insert a heading of `level` 1-6 with `text` after block `id`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `level` | `1` \| `2` \| `3` \| `4` \| `5` \| `6` | `undefined` |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### insertHeadingBefore()

> **insertHeadingBefore**(`id`, `level`, `text?`): `string`

Insert a heading of `level` 1-6 with `text` before block `id`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `level` | `1` \| `2` \| `3` \| `4` \| `5` \| `6` | `undefined` |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### insertImage()

> **insertImage**(`afterId`, `img`): `string`

Insert an image after block `afterId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `afterId` | `string` |
| `img` | \{ `alt?`: `string`; `height?`: `number`; `srcType`: `string`; `url`: `string`; `width?`: `number`; \} |
| `img.alt?` | `string` |
| `img.height?` | `number` |
| `img.srcType` | `string` |
| `img.url` | `string` |
| `img.width?` | `number` |

#### Returns

`string`

***

### insertInlineDatabaseQuery()

> **insertInlineDatabaseQuery**(`blockId`, `at`, `query`): `string`

Insert a scalar saved database question inside a sentence, at character
offset `at` of block `blockId`.
`query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
block, verbatim.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `query` | `string` \| [`DatabaseQueryBlock`](../type-aliases/DatabaseQueryBlock.md) |

#### Returns

`string`

***

### insertInlineEquation()

> **insertInlineEquation**(`blockId`, `at`, `tex`): `string`

Insert an inline equation with TeX `tex` at character offset `at` of block
`blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `tex` | `string` |

#### Returns

`string`

***

### insertLineBreak()

> **insertLineBreak**(`blockId`, `at`): `string`

Insert a line break at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |

#### Returns

`string`

***

### insertListItemAfter()

> **insertListItemAfter**(`id`, `text`, `list?`): `string`

Insert a list item with `text` after list item `id`.
A `list` kind other than the surrounding list's nests the item in a sublist
of that kind.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `text` | `string` | `undefined` |
| `list?` | [`ListKind`](../../ops/type-aliases/ListKind.md) | `'bullet'` |

#### Returns

`string`

***

### insertListItemBefore()

> **insertListItemBefore**(`id`, `text`, `list?`): `string`

Insert a list item with `text` before list item `id`.
A `list` kind other than the surrounding list's nests the item in a sublist
of that kind.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `text` | `string` | `undefined` |
| `list?` | [`ListKind`](../../ops/type-aliases/ListKind.md) | `'bullet'` |

#### Returns

`string`

***

### insertMention()

> **insertMention**(`blockId`, `at`, `mention`): `string`

Insert the mention `mention` describes at character offset `at` of block
`blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `mention` | [`MentionSpec`](../../ops/type-aliases/MentionSpec.md) |

#### Returns

`string`

***

### insertParagraphAfter()

> **insertParagraphAfter**(`id`, `text?`): `string`

Insert a paragraph with `text` after block `id`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### insertParagraphBefore()

> **insertParagraphBefore**(`id`, `text?`): `string`

Insert a paragraph with `text` before block `id`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### insertQuoteAfter()

> **insertQuoteAfter**(`id`, `text?`): `string`

Insert a quote with `text` after block `id`.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### insertTableAfter()

> **insertTableAfter**(`id`, `rows`): `string`

Insert a table after block `id`. `rows[0]` is the header
row; every row needs the same number of cells.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `rows` | `string`[][] |

#### Returns

`string`

***

### insertTableBefore()

> **insertTableBefore**(`id`, `rows`): `string`

Insert a table before block `id`. `rows[0]` is the header
row; every row needs the same number of cells.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `rows` | `string`[][] |

#### Returns

`string`

***

### insertTextAfterInline()

> **insertTextAfterInline**(`inlineRef`, `text`): `this`

Insert plain text right after an inline node such as a mention, date or
equation.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `inlineRef` | `string` |
| `text` | `string` |

#### Returns

`this`

***

### insertVideo()

> **insertVideo**(`afterId`, `vid`): `string`

Insert a video after block `afterId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `afterId` | `string` |
| `vid` | \{ `controls?`: `boolean`; `height?`: `number`; `srcType`: `string`; `url`: `string`; `width?`: `number`; \} |
| `vid.controls?` | `boolean` |
| `vid.height?` | `number` |
| `vid.srcType` | `string` |
| `vid.url` | `string` |
| `vid.width?` | `number` |

#### Returns

`string`

***

### italic()

> **italic**(`id`, `match`, `scope?`): `this`

Italicize each occurrence of `match` in node `id` (or the one `scope`
picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### italicNode()

> **italicNode**(`node`): `this`

Italicize all text in node `node`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `node` | `string` |

#### Returns

`this`

***

### link()

> **link**(`id`, `match`, `url`, `scope?`): `this`

Link each occurrence of `match` in node `id` to `url` (or the one `scope`
picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `url` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### mentionAgentSession()

> **mentionAgentSession**(`blockId`, `at`, `entity`): `string`

Mention an agent session at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `expanded?`: `boolean`; `id`: `string`; `label?`: `string`; \} |
| `entity.expanded?` | `boolean` |
| `entity.id` | `string` |
| `entity.label?` | `string` |

#### Returns

`string`

***

### mentionBookingLink()

> **mentionBookingLink**(`blockId`, `at`, `entity`): `string`

Mention a booking link at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `label?`: `string`; `profileId`: `string`; `slug?`: `string`; `url`: `string`; \} |
| `entity.label?` | `string` |
| `entity.profileId` | `string` |
| `entity.slug?` | `string` |
| `entity.url` | `string` |

#### Returns

`string`

***

### mentionContact()

> **mentionContact**(`blockId`, `at`, `entity`): `string`

Mention a contact or company at character offset `at` of block `blockId`
.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `contactId`: `string`; `emailOrDomain`: `string`; `isCompany`: `boolean`; `name`: `string`; \} |
| `entity.contactId` | `string` |
| `entity.emailOrDomain` | `string` |
| `entity.isCompany` | `boolean` |
| `entity.name` | `string` |

#### Returns

`string`

***

### mentionDate()

> **mentionDate**(`blockId`, `at`, `isoDate`, `displayFormat?`): `string`

Insert a date chip for ISO `isoDate` at character offset `at` of block
`blockId`; same as `insertDate`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `isoDate` | `string` |
| `displayFormat?` | `string` |

#### Returns

`string`

***

### mentionDocument()

> **mentionDocument**(`blockId`, `at`, `entity`): `string`

Mention a document at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `blockName`: `string`; `blockParams?`: `Record`\<`string`, `string`\>; `documentId`: `string`; `documentName`: `string`; \} |
| `entity.blockName` | `string` |
| `entity.blockParams?` | `Record`\<`string`, `string`\> |
| `entity.documentId` | `string` |
| `entity.documentName` | `string` |

#### Returns

`string`

***

### mentionGroup()

> **mentionGroup**(`blockId`, `at`, `entity`): `string`

Mention a group alias at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `groupAlias`: `string`; \} |
| `entity.groupAlias` | `string` |

#### Returns

`string`

***

### mentionPullRequest()

> **mentionPullRequest**(`blockId`, `at`, `entity`): `string`

Mention a pull request at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `id`: `string`; `label?`: `string`; \} |
| `entity.id` | `string` |
| `entity.label?` | `string` |

#### Returns

`string`

***

### mentionTag()

> **mentionTag**(`blockId`, `at`, `entity`): `string`

Mention a tag (a property option) at character offset `at` of block
`blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `color?`: `string`; `name`: `string`; `optionId`: `string`; `propertyDefinitionId`: `string`; `scope`: `"user"` \| `"team"`; \} |
| `entity.color?` | `string` |
| `entity.name` | `string` |
| `entity.optionId` | `string` |
| `entity.propertyDefinitionId` | `string` |
| `entity.scope` | `"user"` \| `"team"` |

#### Returns

`string`

***

### mentionUser()

> **mentionUser**(`blockId`, `at`, `entity`): `string`

Mention a Macro user at character offset `at` of block `blockId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockId` | `string` |
| `at` | `number` |
| `entity` | \{ `email`: `string`; `userId`: `string`; \} |
| `entity.email` | `string` |
| `entity.userId` | `string` |

#### Returns

`string`

***

### merge()

> **merge**(`ids`, `separator?`): `this`

Merge two or more blocks into the first, joining their text with
`separator` (a space by default).

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `ids` | `string`[] | `undefined` |
| `separator?` | `string` | `' '` |

#### Returns

`this`

***

### move()

> **move**(`id`, `at`): `this`

Move block `id` to `at`: `{ after }`, `{ before }`, `{ appendToRoot: true
}` or `{ prependToRoot: true }`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `at` | [`Position`](../../ops/type-aliases/Position.md) |

#### Returns

`this`

***

### numberedList()

> **numberedList**(`idOrIds`): `this`

Turn one block or a run of blocks into a numbered list, one item per block.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `idOrIds` | `string` \| `string`[] |

#### Returns

`this`

***

### outdent()

> **outdent**(`id`, `by?`): `this`

Outdent block or list item `id` one level.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `id` | `string` | `undefined` |
| `by?` | `number` | `1` |

#### Returns

`this`

***

### prependBlock()

> **prependBlock**(`spec`): `string`

Add the block `spec` describes at the start of the document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `spec` | [`NodeSpec`](../../ops/type-aliases/NodeSpec.md) |

#### Returns

`string`

***

### prependListItem()

> **prependListItem**(`listId`, `text`): `string`

Add an item with `text` to the start of list `listId` (the `<ul>`/`<ol>`
id); works on an empty list.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `listId` | `string` |
| `text` | `string` |

#### Returns

`string`

***

### prependParagraph()

> **prependParagraph**(`text?`): `string`

Add a paragraph with `text` at the start of the document.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `text?` | `string` | `''` |

#### Returns

`string`

***

### prependText()

> **prependText**(`id`, `text`): `this`

Add plain text to the start of block `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `text` | `string` |

#### Returns

`this`

***

### remove()

> **remove**(`id`): `this`

Remove node `id` and everything inside it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### removeColumn()

> **removeColumn**(`table`, `col`): `this`

Remove column `col` (0-based) from table `table`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `col` | `number` |

#### Returns

`this`

***

### removeListItem()

> **removeListItem**(`id`): `this`

Remove list item `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### removeMany()

> **removeMany**(`ids`): `this`

Remove each node in `ids`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ids` | `string`[] |

#### Returns

`this`

***

### removeRow()

> **removeRow**(`table`, `row`): `this`

Remove row `row` (0-based) from table `table`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `row` | `number` |

#### Returns

`this`

***

### replace()

> **replace**(`id`, `find`, `to`, `scope?`): `this`

Replace each occurrence of `find` in node `id` with `to`, keeping the
surrounding formatting (or the one `scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `find` | `string` |
| `to` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### setCell()

> **setCell**(`table`, `row`, `col`, `text`): `this`

Replace the text of the cell at `row`, `col` (0-based, row 0 is the header)
in table `table`. Pass the table id, not a row or cell id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `row` | `number` |
| `col` | `number` |
| `text` | `string` |

#### Returns

`this`

***

### setChecked()

> **setChecked**(`id`, `checked`): `this`

Check or uncheck the checklist item `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `checked` | `boolean` |

#### Returns

`this`

***

### setDatabaseLocation()

> **setDatabaseLocation**(`id`, `location`): `this`

Show another table, and optionally view, in the embedded database card
`id`. Pass ids (`{ tableId, viewId }`) or handles (`{ table, view }`), such
as an SDK `DatabaseTable` and `DatabaseView`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `location` | [`DatabaseLocation`](../type-aliases/DatabaseLocation.md) |

#### Returns

`this`

***

### setDatabaseQueryView()

> **setDatabaseQueryView**(`id`, `view`): `this`

Change how database question `id` is shown (display mode, title, chart,
height); `null` clears a field.
The question and its SQL never change here; insert a new question instead.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `view` | [`DatabaseQueryView`](../../ops/type-aliases/DatabaseQueryView.md) |

#### Returns

`this`

***

### setDate()

> **setDate**(`id`, `date`, `displayFormat?`): `this`

Change date chip `id` to ISO `date`, optionally with a new display format.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `date` | `string` |
| `displayFormat?` | `string` |

#### Returns

`this`

***

### setEquation()

> **setEquation**(`id`, `tex`): `this`

Replace the TeX source of the equation node `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `tex` | `string` |

#### Returns

`this`

***

### setImageAlt()

> **setImageAlt**(`id`, `alt`): `this`

Set the alt text of image `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `alt` | `string` |

#### Returns

`this`

***

### setImageUrl()

> **setImageUrl**(`id`, `url`): `this`

Point image `id` at `url`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `url` | `string` |

#### Returns

`this`

***

### setIndent()

> **setIndent**(`id`, `level`): `this`

Set the indent level of block or list item `id` to `level` (0 or more).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `level` | `number` |

#### Returns

`this`

***

### setLanguage()

> **setLanguage**(`id`, `language`): `this`

Set the language of code block `id`; same as `convertToCodeBlock`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `language` | `string` |

#### Returns

`this`

***

### setListType()

> **setListType**(`id`, `list`): `this`

Turn block `id` (or a list) into a list of kind `list`: `bullet`, `number`,
or `check`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `list` | [`ListKind`](../../ops/type-aliases/ListKind.md) |

#### Returns

`this`

***

### setText()

> **setText**(`id`, `text`): `this`

Replace the text of node `id`: a block id replaces the whole block's
content, a text-run id replaces only that run.
An empty string on a run removes the run.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `text` | `string` |

#### Returns

`this`

***

### setVideoControls()

> **setVideoControls**(`id`, `controls`): `this`

Show or hide the playback controls of video `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `controls` | `boolean` |

#### Returns

`this`

***

### setVideoUrl()

> **setVideoUrl**(`id`, `url`): `this`

Point video `id` at `url`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `url` | `string` |

#### Returns

`this`

***

### strike()

> **strike**(`id`, `match`, `scope?`): `this`

Strike through each occurrence of `match` in node `id` (or the one `scope`
picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### strikeNode()

> **strikeNode**(`node`): `this`

Strike through all text in node `node`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `node` | `string` |

#### Returns

`this`

***

### unbold()

> **unbold**(`id`, `match`, `scope?`): `this`

Remove bold from each occurrence of `match` in node `id` (or the one
`scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### uncheck()

> **uncheck**(`id`): `this`

Uncheck the checklist item `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`this`

***

### underline()

> **underline**(`id`, `match`, `scope?`): `this`

Underline each occurrence of `match` in node `id` (or the one `scope`
picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### underlineNode()

> **underlineNode**(`node`): `this`

Underline all text in node `node`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `node` | `string` |

#### Returns

`this`

***

### unhighlight()

> **unhighlight**(`id`, `match`, `scope?`): `this`

Remove the highlight from each occurrence of `match` in node `id` (or the
one `scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### uninlineCode()

> **uninlineCode**(`id`, `match`, `scope?`): `this`

Remove inline-code formatting from each occurrence of `match` in node `id`
(or the one `scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### unitalic()

> **unitalic**(`id`, `match`, `scope?`): `this`

Remove italics from each occurrence of `match` in node `id` (or the one
`scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### unlink()

> **unlink**(`id`, `match`, `scope?`): `this`

Remove links from each occurrence of `match` in node `id`, keeping the text
(or the one `scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### unstrike()

> **unstrike**(`id`, `match`, `scope?`): `this`

Remove strikethrough from each occurrence of `match` in node `id` (or the
one `scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`

***

### ununderline()

> **ununderline**(`id`, `match`, `scope?`): `this`

Remove underline from each occurrence of `match` in node `id` (or the one
`scope` picks).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `match` | `string` |
| `scope?` | [`Scope`](../../ops/type-aliases/Scope.md) |

#### Returns

`this`
