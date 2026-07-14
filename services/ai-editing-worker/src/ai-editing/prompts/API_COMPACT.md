# Summary of Editor API

The writer has the complete API reference. Use this compact list to help yourself understand what our editing team is capable of.

## Inline Formatting

- Match-based: `bold`, `italic`, `underline`, `strike`, `inlineCode`, `unbold`, `unitalic`, `ununderline`, `unstrike`, `uninlineCode`, `format`, `clearFormat`, `clearAllFormat`, `highlight`, `unhighlight`, `link`, `unlink`
- Text-node based: `boldNode`, `italicNode`, `underlineNode`, `strikeNode`, `codeNode`, `formatNode`, `clearNodeFormat`

## Text Content

- `setText`, `replace`, `appendText`, `prependText`, `setEquation`

## Block Type Conversion

- `convertToParagraph`, `convertToHeading`, `convertToQuote`, `convertToCodeBlock(id, language)`, `setLanguage(id, language)`
- Code block language is required. Use `setLanguage(id, language)` to change an existing code block's language.
- A type conversion gives the block a fresh id: the old id + `~vN` suffix (`b1` → `b1~v1`). Same block; use the latest id going forward.

## Lists

- `bulletList`, `numberedList`, `checklist`, `setListType`, `check`, `uncheck`, `setChecked`, `indent`, `outdent`, `setIndent`
- Add/remove items next to an existing item: `insertListItemAfter(liId, text, list?)`, `insertListItemBefore(liId, text, list?)`, `removeListItem(liId)`. `list` is `'bullet'`|`'number'`|`'check'` (default `'bullet'`); a differing kind nests a sublist. Pass an existing `<li>` id.
- Add an item to a list as a whole (incl. an **empty** list): `appendListItem(listId, text)`, `prependListItem(listId, text)`. Pass the `<ul>`/`<ol>` id; the item inherits the list's kind. All item inserts return the new `<li>` id.

## Structure

- Insert relative to existing blocks: `insertParagraphAfter`, `insertParagraphBefore`, `insertHeadingAfter`, `insertHeadingBefore`, `insertQuoteAfter`, `insertCodeBlockAfter(id, language, text?)`, `insertBlockAfter`, `insertBlockBefore`
- Insert at document edges: `appendParagraph`, `prependParagraph`, `appendBlock`, `prependBlock`
- Rearrange/remove: `move`, `remove`, `removeMany`, `merge`

## Tables

- `insertTableAfter`, `insertTableBefore`, `appendTable`, `setCell`, `addRow`, `addColumn`, `removeRow`, `removeColumn`

## Native Objects

- Block objects: `insertDivider`, `insertImage`, `insertVideo`, `insertEquation`; or via `insertBlockAfter`/`appendBlock` with specs `document-card` (documentId, documentName, blockName, blockParams?) and `html-render` (html)
- Inline objects: `insertInlineEquation`, `insertLineBreak`, `insertDate`, `insertMention`, `mentionUser`, `mentionContact`, `mentionGroup`, `mentionDocument`
- To place text after an inline object: `insertTextAfterInline(inlineRef, text)`. Do **not** use `appendText` for this — it targets the block's last text node and misplaces the text when an inline object is the last child.
- Updates: `setImageAlt`, `setImageUrl`, `setVideoUrl`, `setVideoControls`, `setDate`

Our editing team is very well versed in how to use the library and you should never tell them how to get the job done. But this is to help you understand what they are capable of.
