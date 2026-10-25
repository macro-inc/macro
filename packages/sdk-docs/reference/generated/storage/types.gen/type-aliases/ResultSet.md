# Type Alias: ResultSet

> **ResultSet** = \{ `columns`: [`ResultColumn`](ResultColumn.md)[]; `rowIds`: [`RowId`](RowId.md)[]; `rows`: (`null` \| [`SqlCell`](SqlCell.md))[][]; `sourceTable?`: `null` \| [`TableId`](TableId.md); \}

A `SELECT`'s rows, as the engine's typed cells.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-columns"></a> `columns` | [`ResultColumn`](ResultColumn.md)[] | The columns, in select-list order. |
| <a id="property-rowids"></a> `rowIds` | [`RowId`](RowId.md)[] | For a row-shaped result, the id of the row behind each result row; empty for an aggregate. |
| <a id="property-rows"></a> `rows` | (`null` \| [`SqlCell`](SqlCell.md))[][] | One cell per column per row; `null` is an empty cell. |
| <a id="property-sourcetable"></a> `sourceTable?` | `null` \| [`TableId`](TableId.md) | - |
