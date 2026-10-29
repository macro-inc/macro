# Type Alias: ConvertIntoNewColumnOptions

> **ConvertIntoNewColumnOptions** = \{ `name?`: `string`; `to`: [`ColumnType`](ColumnType.md); \}

Options for [Database.convertColumnIntoNewColumn](../classes/Database.md#convertcolumnintonewcolumn).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name?` | `string` | Display name of the new column; by default the original's name followed by the type, as in `Due (Date)`. |
| <a id="property-to"></a> `to` | [`ColumnType`](ColumnType.md) | The type of the new column. |
