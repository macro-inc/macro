# Type Alias: GetLocationHandlerData

> **GetLocationHandlerData** = \{ `body?`: `never`; `path`: \{ `document_id`: `string`; \}; `query`: \{ `document_version_id`: `number`; `get_converted_docx_url`: `boolean`; \}; `url`: `"/documents/{document_id}/location"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `document_id`: `string`; \} | - |
| `path.document_id` | `string` | Document ID |
| <a id="property-query"></a> `query` | \{ `document_version_id`: `number`; `get_converted_docx_url`: `boolean`; \} | - |
| `query.document_version_id` | `number` | A specific document version id to get the location for. |
| `query.get_converted_docx_url` | `boolean` | If true, this will return the converted docx url. |
| <a id="property-url"></a> `url` | `"/documents/{document_id}/location"` | - |
