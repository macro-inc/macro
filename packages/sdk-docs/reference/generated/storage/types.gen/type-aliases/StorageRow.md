# Type Alias: StorageRow

> **StorageRow** = \{ `cells`: \{\[`key`: `string`\]: [`PropertyValue`](PropertyValue.md); \}; `rowId`: [`RowId`](RowId.md); \}

One storage row, with cells keyed by column placement.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cells"></a> `cells` | \{\[`key`: `string`\]: [`PropertyValue`](PropertyValue.md); \} | Populated cells. |
| <a id="property-rowid"></a> `rowId` | [`RowId`](RowId.md) | Row identity, independent of any referenced entity. |
