# Class: DocumentStructure

A markdown document or task as the structured editor sees it: XML whose
elements carry durable node ids. Use it for exact, model-free edits; for
anything you can describe in words, use `document.edit(instructions)`.

## Example

```js
const structure = await document.structure();
// structure.xml: <h1 id="a1"><t id="a2">Plan</t></h1><ul id="b1"><li id="b2">…
await structure.applyEdits((editor) => {
  editor.check('b2');
  editor.replace('a2', 'Plan', 'Plan (approved)');
});
```

## Constructors

### Constructor

> **new DocumentStructure**(`client`, `document`, `xml`): `DocumentStructure`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `document` | [`Document`](../../../documents/document/classes/Document.md) |
| `xml` | `string` |

#### Returns

`DocumentStructure`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-document"></a> `document` | `readonly` | [`Document`](../../../documents/document/classes/Document.md) | The document this structure was read from. |
| <a id="property-xml"></a> `xml` | `readonly` | `string` | The document as XML. Each element is a block (`p`, `h1`, `li`, `table`, ...) or a text run (`t`), with the `id` that editor methods take. |

## Methods

### applyEdits()

> **applyEdits**(`build`, `options?`): `Promise`\<[`StructuredEditResult`](../interfaces/StructuredEditResult.md)\>

Apply exact edits with no model: call `editor` methods with ids from
[xml](#property-xml); the batch commits all or nothing and merges with concurrent
editors.

`build` runs synchronously and only records ops; a bad argument or an id
not in this structure throws `EditError` before anything is sent. Insert
methods return the new node's id, usable later in the same batch. At most
200 ops per call.

Throws [DocumentEditRejectedError](DocumentEditRejectedError.md) when an op fails against the live
document (nothing committed; read again) and [EditOutcomeUnknownError](../../../documents/ai-edit/classes/EditOutcomeUnknownError.md)
when the outcome is unknown (read before retrying).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `build` | (`editor`) => `void` |
| `options?` | [`ApplyEditsOptions`](../interfaces/ApplyEditsOptions.md) |

#### Returns

`Promise`\<[`StructuredEditResult`](../interfaces/StructuredEditResult.md)\>

#### Example

**Check off finished items and restyle a chart.**

```js
const structure = await task.structure();
try {
  await structure.applyEdits((editor) => {
    for (const id of finishedItemIds) editor.check(id);
    editor.setDatabaseQueryView('q1', { displayMode: 'pie', title: 'Share' });
    editor.setDatabaseLocation('c4', { table: accounts });
  });
} catch (error) {
  if (error.name !== 'DocumentEditRejectedError') throw error;
  return { data: { failed: error.failures } };
}
```
