# Type Alias: GetDatabaseTableChangesData

> **GetDatabaseTableChangesData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; `table_id`: `string`; \}; `query`: \{ `since`: `number`; \}; `url`: `"/databases/{id}/tables/{table_id}/changes"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; `table_id`: `string`; \} | - |
| `path.id` | `string` | Database id |
| `path.table_id` | `string` | Table id |
| <a id="property-query"></a> `query` | \{ `since`: `number`; \} | - |
| `query.since` | `number` | The table version the reader last read. |
| <a id="property-url"></a> `url` | `"/databases/{id}/tables/{table_id}/changes"` | - |
