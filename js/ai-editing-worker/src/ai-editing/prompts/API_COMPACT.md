# Compact Editor API

The writer has the complete API reference. Use this compact list to plan native edits and describe writer tasks with the right capability names.

## Inline Formatting

- Match-based: `bold`, `italic`, `underline`, `strike`, `inlineCode`, `unbold`, `unitalic`, `ununderline`, `unstrike`, `uninlineCode`, `format`, `clearFormat`, `clearAllFormat`, `highlight`, `unhighlight`, `link`, `unlink`
- Text-node based: `boldNode`, `italicNode`, `underlineNode`, `strikeNode`, `codeNode`, `formatNode`, `clearNodeFormat`

## Text Content

- `setText`, `replace`, `appendText`, `prependText`, `setEquation`

## Block Type Conversion

- `convertToParagraph`, `convertToHeading`, `convertToQuote`, `convertToCodeBlock(id, language)`, `setLanguage(id, language)`
- Code block language is required. Use `setLanguage(id, language)` to change an existing code block's language.

## Lists

- `bulletList`, `numberedList`, `checklist`, `setListType`, `check`, `uncheck`, `setChecked`, `indent`, `outdent`, `setIndent`, `sortList`
- Add/remove items in an existing list: `insertListItemAfter(liId, text, list?)`, `insertListItemBefore(liId, text, list?)`, `removeListItem(liId)`. `list` is `'bullet'`|`'number'`|`'check'` (default `'bullet'`); a differing kind nests a sublist. Pass an existing `<li>` id — NOT the `<ul>`/`<ol>` id.

## Structure

- Insert relative to existing blocks: `insertParagraphAfter`, `insertParagraphBefore`, `insertHeadingAfter`, `insertHeadingBefore`, `insertQuoteAfter`, `insertCodeBlockAfter(id, language, text?)`, `insertBlockAfter`, `insertBlockBefore`
- Insert at document edges: `appendParagraph`, `prependParagraph`, `appendBlock`, `prependBlock`
- Rearrange/remove: `move`, `remove`, `removeMany`, `merge`, `split`

## Tables

- `insertTableAfter`, `insertTableBefore`, `appendTable`, `setCell`, `addRow`, `addColumn`, `removeRow`, `removeColumn`

## Native Objects

- Block objects: `insertDivider`, `insertImage`, `insertVideo`, `insertEquation`
- Inline objects: `insertInlineEquation`, `insertLineBreak`, `insertDate`, `insertMention`, `mentionUser`, `mentionContact`, `mentionGroup`, `mentionDocument`
- Updates: `setImageAlt`, `setImageUrl`, `setVideoUrl`, `setVideoControls`, `setDate`

Prefer native objects over text simulations: use dividers, tables, headings, quotes, code blocks, images, videos, equations, dates, and mentions when those are what the user means.
