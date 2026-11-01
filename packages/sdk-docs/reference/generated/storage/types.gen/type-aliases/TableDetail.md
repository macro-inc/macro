# Type Alias: TableDetail

> **TableDetail** = \{ `columns`: [`ColumnDetail`](ColumnDetail.md)[]; `sql_name`: `string`; `table`: [`Table`](Table.md); `views`: [`DatabaseView`](DatabaseView.md)[]; \}

One table with its columns and SQL name.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-columns"></a> `columns` | [`ColumnDetail`](ColumnDetail.md)[] | Columns in display order. |
| <a id="property-sql_name"></a> `sql_name` | `string` | The name SQL refers to the table by: its display name quoted and qualified by the database's (`FROM "Plans"."Table 1"`). |
| <a id="property-table"></a> `table` | [`Table`](Table.md) | The table. |
| <a id="property-views"></a> `views` | [`DatabaseView`](DatabaseView.md)[] | The table's views, in their order. |
