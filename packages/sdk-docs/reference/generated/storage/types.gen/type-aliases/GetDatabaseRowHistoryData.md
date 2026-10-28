# Type Alias: GetDatabaseRowHistoryData

> **GetDatabaseRowHistoryData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; `row_id`: `string`; `table_id`: `string`; \}; `query?`: `never`; `url`: `"/databases/{id}/tables/{table_id}/rows/{row_id}/history"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; `row_id`: `string`; `table_id`: `string`; \} | - |
| `path.id` | `string` | Database id |
| `path.row_id` | `string` | Row id |
| `path.table_id` | `string` | Table id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/databases/{id}/tables/{table_id}/rows/{row_id}/history"` | - |
