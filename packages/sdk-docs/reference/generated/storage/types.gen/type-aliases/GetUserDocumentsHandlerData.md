# Type Alias: GetUserDocumentsHandlerData

> **GetUserDocumentsHandlerData** = \{ `body?`: `never`; `path?`: `never`; `query`: \{ `file_type`: `string`; `limit`: `number`; `offset`: `number`; \}; `url`: `"/documents"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `file_type`: `string`; `limit`: `number`; `offset`: `number`; \} | - |
| `query.file_type` | `string` | The file type to filter by. Default all. |
| `query.limit` | `number` | The maximum number of documents to retreive. Default 10, max 100. |
| `query.offset` | `number` | The offset to start from. Default 0. |
| <a id="property-url"></a> `url` | `"/documents"` | - |
