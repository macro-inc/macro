# Type Alias: CellWrite

> **CellWrite** = \{ `column`: `string`; `value`: [`CellValue`](CellValue.md); \}

One cell of a row: which column, and its new value.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-column"></a> `column` | `string` | The column placement. |
| <a id="property-value"></a> `value` | [`CellValue`](CellValue.md) | The value, or [`CellValue::Clear`] to empty the cell. |
