# Type Alias: ConvertDatabaseColumnData

> **ConvertDatabaseColumnData** = \{ `body`: [`ColumnConversionRequest`](ColumnConversionRequest.md); `path`: \{ `column_id`: `string`; `id`: `string`; `table_id`: `string`; \}; `query?`: `never`; `url`: `"/databases/{id}/tables/{table_id}/columns/{column_id}/conversion"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`ColumnConversionRequest`](ColumnConversionRequest.md) |
| <a id="property-path"></a> `path` | \{ `column_id`: `string`; `id`: `string`; `table_id`: `string`; \} |
| `path.column_id` | `string` |
| `path.id` | `string` |
| `path.table_id` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/databases/{id}/tables/{table_id}/columns/{column_id}/conversion"` |
