# `editor` API

All edits go through the `editor` object. `id` is a node id from the XML. Methods that create a node return a handle you can pass to later calls. Pass plain text only. `scope` is optional: `{ all: true }` for every match, `{ nth: N }` for the 1-based Nth match, or omitted for the first/default behavior.

## Inline Formatting By Match

- `bold(id, match, scope?)` · `italic(id, match, scope?)` · `underline(id, match, scope?)` · `strike(id, match, scope?)` · `inlineCode(id, match, scope?)`
- `unbold(id, match, scope?)` · `unitalic(id, match, scope?)` · `ununderline(id, match, scope?)` · `unstrike(id, match, scope?)` · `uninlineCode(id, match, scope?)`
- `format(id, match, format, on?, scope?)` where `format` is `bold`, `italic`, `underline`, `strike`, or `code`
- `clearFormat(id, match?, scope?)` · `clearAllFormat(id)`
- `highlight(id, match, scope?)` · `unhighlight(id, match, scope?)`
- `link(id, match, url, scope?)` · `unlink(id, match, scope?)`

```ts
editor.bold('b1', 'quick');
editor.italic('b1', 'brown');
editor.highlight('b1', 'the');
editor.link('b1', 'fox', 'https://x');
```

Before:

```xml
<doc>
  <p id="b1">
    <t id="t1">the quick brown fox</t>
  </p>
</doc>
```

After:

```xml
<doc>
  <p id="b1">
    <mark id="b2" direction="null" format="" indent="0" version="1" ids="[]">
      <t id="t1">the</t>
    </mark>
    <t id="t2"> </t>
    <t id="t3" bold="true">quick</t>
    <t id="t4"> </t>
    <t id="t5" italic="true">brown</t>
    <t id="t6"> </t>
    <a id="b3" href="https://x">
      <t id="t7">fox</t>
    </a>
  </p>
</doc>
```

## Inline Formatting By Text Node

- `boldNode(textId)` · `italicNode(textId)` · `underlineNode(textId)` · `strikeNode(textId)` · `codeNode(textId)`
- `formatNode(textId, format, on?)` · `clearNodeFormat(textId)`

```ts
editor.boldNode('t1');
editor.underlineNode('t1');
```

Before:

```xml
<doc>
  <p id="b1">
    <t id="t1">Hello world</t>
  </p>
</doc>
```

After:

```xml
<doc>
  <p id="b1">
    <t id="t1" bold="true" underline="true">Hello world</t>
  </p>
</doc>
```

## Text Content

- `setText(id, text)`
- `replace(id, find, to, scope?)`
- `appendText(id, text)` · `prependText(id, text)`
- `setEquation(id, tex)`

```ts
editor.setText('b1', 'replaced');
editor.appendText('b2', '!!!');
editor.prependText('b3', '> ');
editor.replace('b3', 'third', 'THIRD');
editor.setEquation('eq1', 'y^2');
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">first</t></p>
  <p id="b2"><t id="t2">second</t></p>
  <p id="b3"><t id="t3">third</t></p>
  <equation id="eq1" version="1" equation="x^2" inline="false"/>
</doc>
```

After:

```xml
<doc>
  <p id="b1"><t id="t1">replaced</t></p>
  <p id="b2"><t id="t2">second!!!</t></p>
  <p id="b3"><t id="t3">&gt; THIRD</t></p>
  <equation id="eq1" version="1" equation="y^2" inline="false"/>
</doc>
```

## Block Type Conversion

- `convertToParagraph(id)` · `convertToHeading(id, level)` · `convertToQuote(id)` · `convertToCodeBlock(id, language)` · `setLanguage(id, language)`

```ts
editor.convertToHeading('b1', 2);
editor.convertToQuote('b2');
editor.convertToCodeBlock('b3', 'ts');
editor.convertToParagraph('b4');
editor.setLanguage('b3', 'python');
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">Title</t></p>
  <p id="b2"><t id="t2">A quote</t></p>
  <p id="b3"><t id="t3">code here</t></p>
  <h3 id="b4"><t id="t4">Back to paragraph</t></h3>
</doc>
```

After:

```xml
<doc>
  <h2 id="b1"><t id="t1">Title</t></h2>
  <blockquote id="b2"><t id="t2">A quote</t></blockquote>
  <custom-code id="b3" direction="null" format="" indent="0" version="1" language="python"><t id="t3">code here</t></custom-code>
  <p id="b4"><t id="t4">Back to paragraph</t></p>
</doc>
```

## Lists

- `bulletList(idOrIds)` · `numberedList(idOrIds)` · `checklist(idOrIds)` · `setListType(id, kind)`
- `check(id)` · `uncheck(id)` · `setChecked(id, bool)`
- `indent(id, by?)` · `outdent(id, by?)` · `setIndent(id, level)`
- `insertListItemAfter(liId, text, list?)` · `insertListItemBefore(liId, text, list?)` · `removeListItem(liId)`

To add or remove items in an *existing* list, pass the id of a sibling `<li>` — never the `<ul>`/`<ol>` id. `list` (`'bullet'`|`'number'`|`'check'`, default `'bullet'`) sets the new item's kind; when it differs from the surrounding list, the item is wrapped in a nested sublist of that kind. The insert methods return a handle to the new `<li>`.

```ts
editor.checklist(['b1', 'b2']);
editor.check('b1');
editor.indent('b2');
editor.outdent('b2');
editor.setChecked('b2', false);
const li = editor.insertListItemAfter('li1', 'second item');
editor.insertListItemAfter(li, 'nested', 'number');
editor.removeListItem('li2');
```

Before:

```xml
<doc>
  <ul id="list1"><li id="li1"><t id="t1">first item</t></li><li id="li2" value="2"><t id="t2">old item</t></li></ul>
</doc>
```

After:

```xml
<doc>
  <ul id="list1">
    <li id="li1"><t id="t1">first item</t></li>
    <li id="b1" value="2"><t id="t3">second item</t></li>
    <li id="b2" value="3">
      <ol id="b3"><li id="b4"><t id="t4">nested</t></li></ol>
    </li>
  </ul>
</doc>
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">task b</t></p>
  <p id="b2"><t id="t2">task a</t></p>
  <ul id="list1"><li id="li1"><t id="t3">z</t></li><li id="li2" value="2"><t id="t4">a</t></li></ul>
</doc>
```

After:

```xml
<doc>
  <ul id="b3" listType="check">
    <li id="b4" checked="true"><t id="t1">task b</t></li>
    <li id="b5" value="2" checked="false"><t id="t2">task a</t></li>
  </ul>
  <ul id="list1"><li id="li2"><t id="t4">a</t></li><li id="li1" value="2"><t id="t3">z</t></li></ul>
</doc>
```

## Structure

- `insertParagraphAfter(id, text?)` · `insertParagraphBefore(id, text?)`
- `insertHeadingAfter(id, level, text?)` · `insertHeadingBefore(id, level, text?)`
- `insertQuoteAfter(id, text?)` · `insertCodeBlockAfter(id, language, text?)`
- `insertBlockAfter(id, spec)` · `insertBlockBefore(id, spec)`
- `appendParagraph(text?)` · `prependParagraph(text?)` · `appendBlock(spec)` · `prependBlock(spec)`
- `move(id, position)` where `position` is `{ after: id }`, `{ before: id }`, `{ appendToRoot: true }`, or `{ prependToRoot: true }`
- `remove(id)` · `removeMany(ids)` · `merge(ids, separator?)`

```ts
editor.insertHeadingBefore('b1', 1, 'Title');
const c = editor.insertParagraphAfter('b2', 'Conclusion');
editor.appendText(c, '!');
editor.appendParagraph('Footer');
editor.move('b2', { after: c });
editor.remove('b4');
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">Intro</t></p>
  <p id="b2"><t id="t2">Body</t></p>
  <p id="b4"><t id="t3">Remove me</t></p>
</doc>
```

After:

```xml
<doc>
  <h1 id="b3"><t id="t4">Title</t></h1>
  <p id="b1"><t id="t1">Intro</t></p>
  <p id="b5"><t id="t5">Conclusion!</t></p>
  <p id="b2"><t id="t2">Body</t></p>
  <p id="b6"><t id="t6">Footer</t></p>
</doc>
```

## Tables

- `insertTableAfter(id, rows)` · `insertTableBefore(id, rows)` · `appendTable(rows)` where `rows` is `string[][]` and row 0 is the header
- `setCell(tableId, row, col, text)`
- `addRow(tableId, at?)` · `addColumn(tableId, at?)` · `removeRow(tableId, row)` · `removeColumn(tableId, col)`

```ts
const t = editor.appendTable([['Item', 'Done']]);
editor.addRow(t);
editor.setCell(t, 1, 1, 'yes');
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">Tasks</t></p>
</doc>
```

After:

```xml
<doc>
  <p id="b1"><t id="t1">Tasks</t></p>
  <table id="b2">
    <tr id="b3"><td id="b4" headerState="1"><p id="b5"><t id="t2">Item</t></p></td><td id="b6" headerState="1"><p id="b7"><t id="t3">Done</t></p></td></tr>
    <tr id="b8"><td id="b9"><p id="b10"/></td><td id="b11"><p id="b12"><t id="t4">yes</t></p></td></tr>
  </table>
</doc>
```

## Media, Math, And Inline Objects

- `insertDivider(afterId)`
- `insertImage(afterId, { srcType, url, alt?, width?, height? })`
- `insertVideo(afterId, { srcType, url, controls?, width?, height? })`
- `insertEquation(afterId, tex)` · `insertInlineEquation(blockId, at, tex)`
- `insertLineBreak(blockId, at)`
- `insertDate(blockId, at, isoDate, displayFormat?)`

```ts
editor.insertDivider('b1');
editor.insertImage('b1', { srcType: 'url', url: 'https://x/cat.png', alt: 'cat' });
editor.insertVideo('b1', { srcType: 'url', url: 'https://x/movie.mp4', controls: true });
editor.insertEquation('b1', 'E=mc^2');
editor.insertInlineEquation('b2', 0, 'x^2');
editor.insertLineBreak('b2', 3);
editor.insertDate('b2', 4, '2026-06-23', 'MMM d, yyyy');
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">Above</t></p>
  <p id="b2"><t id="t2">Below</t></p>
</doc>
```

After:

```xml
<doc>
  <p id="b1"><t id="t1">Above</t></p>
  <equation id="b3" version="1" equation="E=mc^2" inline="false"/>
  <video id="b4" version="1" srcType="url" _id="" url="https://x/movie.mp4" width="0" height="0" scale="1" constrainedWidth="null" constrainedHeight="null" controls="true"/>
  <image id="b5" version="1" srcType="url" _id="" url="https://x/cat.png" width="0" height="0" scale="1" constrainedWidth="null" constrainedHeight="null" alt="cat"/>
  <hr id="b6"/>
  <p id="b2"><equation id="b7" version="1" equation="x^2" inline="true"/><t id="t2">Bel</t><br id="b8"/><date id="b9" date="2026-06-23" displayFormat="MMM d, yyyy"/><t id="t3">ow</t></p>
</doc>
```

## Update Existing Media And Dates

- `setImageAlt(id, alt)` · `setImageUrl(id, url)`
- `setVideoUrl(id, url)` · `setVideoControls(id, controls)`
- `setDate(id, isoDate, displayFormat?)`

```ts
editor.setImageAlt('img1', 'dog');
editor.setImageUrl('img1', 'https://x/dog.png');
editor.setVideoUrl('vid1', 'https://x/new.mp4');
editor.setVideoControls('vid1', false);
editor.setDate('date1', '2026-07-01', 'yyyy-MM-dd');
```

Before:

```xml
<doc>
  <image id="img1" version="1" srcType="url" _id="" url="https://x/cat.png" alt="cat"/>
  <video id="vid1" version="1" srcType="url" _id="" url="https://x/old.mp4" controls="true"/>
  <p id="b1"><date id="date1" date="2026-06-23" displayFormat="MMM d"/></p>
</doc>
```

After:

```xml
<doc>
  <image id="img1" version="1" srcType="url" _id="" url="https://x/dog.png" alt="dog"/>
  <video id="vid1" version="1" srcType="url" _id="" url="https://x/new.mp4" controls="false"/>
  <p id="b1"><date id="date1" date="2026-07-01" displayFormat="yyyy-MM-dd"/></p>
</doc>
```

## Mentions

- `insertMention(blockId, at, mention)`
- `mentionUser(blockId, at, { userId, email })`
- `mentionContact(blockId, at, { contactId, name, emailOrDomain, isCompany })`
- `mentionGroup(blockId, at, { groupAlias })`
- `mentionDocument(blockId, at, { documentId, documentName, blockName })`

```ts
editor.mentionUser('b1', 6, { userId: 'u1', email: 'a@example.com' });
editor.mentionContact('b1', 7, { contactId: 'c1', name: 'Acme', emailOrDomain: 'acme.com', isCompany: true });
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">Email </t></p>
</doc>
```

After:

```xml
<doc>
  <p id="b1"><t id="t1">Email </t><mention id="m1" kind="user" userId="u1" email="a@example.com"/><mention id="m2" kind="contact" contactId="c1" name="Acme" emailOrDomain="acme.com" isCompany="true"/></p>
</doc>
```

## Node Specs

- `{ block: 'paragraph', text? }`
- `{ block: 'heading', level, text? }`
- `{ block: 'quote', text? }`
- `{ block: 'code', language, text? }`
- `{ block: 'list', list: 'bullet'|'number'|'check', items: string[] }`
- `{ block: 'table', rows }`
- `{ block: 'divider' }`
- `{ block: 'image', srcType, url, alt?, width?, height? }`
- `{ block: 'video', srcType, url, controls?, width?, height? }`
- `{ block: 'equation', tex, inline? }`

```ts
editor.appendBlock({ block: 'heading', level: 2, text: 'Section' });
editor.appendBlock({ block: 'list', list: 'check', items: ['todo a', 'todo b'] });
editor.appendBlock({ block: 'code', language: 'ts', text: 'const x = 1' });
```

Before:

```xml
<doc>
  <p id="b1"><t id="t1">Doc</t></p>
</doc>
```

After:

```xml
<doc>
  <p id="b1"><t id="t1">Doc</t></p>
  <h2 id="b2"><t id="t2">Section</t></h2>
  <ul id="b3" listType="check"><li id="b4"><t id="t3">todo a</t></li><li id="b5" value="2"><t id="t4">todo b</t></li></ul>
  <custom-code id="b6" direction="null" format="" indent="0" version="1" language="ts"><t id="t5">const x = 1</t></custom-code>
</doc>
```
