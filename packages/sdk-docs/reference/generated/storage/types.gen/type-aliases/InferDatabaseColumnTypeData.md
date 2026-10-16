# Type Alias: InferDatabaseColumnTypeData

> **InferDatabaseColumnTypeData** = \{ `body`: [`InferColumnTypeRequest`](InferColumnTypeRequest.md); `path`: \{ `column_id`: `string`; `id`: `string`; `table_id`: `string`; \}; `query?`: `never`; `url`: `"/databases/{id}/tables/{table_id}/columns/{column_id}/infer-type"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`InferColumnTypeRequest`](InferColumnTypeRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `column_id`: `string`; `id`: `string`; `table_id`: `string`; \} | - |
| `path.column_id` | `string` | Column id |
| `path.id` | `string` | Database id |
| `path.table_id` | `string` | Table id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/databases/{id}/tables/{table_id}/columns/{column_id}/infer-type"` | - |
