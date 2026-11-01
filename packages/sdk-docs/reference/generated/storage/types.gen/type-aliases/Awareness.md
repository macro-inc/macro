# Type Alias: Awareness

> **Awareness** = \{ `columnId?`: `string`; `editing?`: `boolean`; `endColumnId?`: `string`; `endRowId?`: `string`; `left?`: `boolean`; `peerId?`: `string`; `rowId?`: `string`; `tableId`: `string`; \}

Where one viewer is inside a database right now: ephemeral, relayed to
the other viewers and never stored. A missing row or column means the
viewer is on the table but on no cell. Optional end row and column IDs
mark the opposite corner of a rectangular cell selection.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-columnid"></a> `columnId?` | `string` | The column placement of the focused cell, if any. |
| <a id="property-editing"></a> `editing?` | `boolean` | Whether the cell is open for editing. |
| <a id="property-endcolumnid"></a> `endColumnId?` | `string` | The opposite column corner of a selected rectangle, if any. |
| <a id="property-endrowid"></a> `endRowId?` | `string` | The opposite row corner of a selected rectangle, if any. |
| <a id="property-left"></a> `left?` | `boolean` | Whether the viewer left the database; other viewers drop their state. |
| <a id="property-peerid"></a> `peerId?` | `string` | This mounted client's random peer id, distinct from its authenticated user. Older clients omit it and remain visible as one peer per user. |
| <a id="property-rowid"></a> `rowId?` | `string` | The row of the focused cell, if any. |
| <a id="property-tableid"></a> `tableId` | `string` | The table the viewer is looking at. |
