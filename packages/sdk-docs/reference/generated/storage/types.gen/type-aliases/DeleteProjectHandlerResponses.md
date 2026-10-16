# Type Alias: DeleteProjectHandlerResponses

> **DeleteProjectHandlerResponses** = \{ `200`: \{ `data`: \{ `chat_ids`: `string`[]; `document_ids`: `string`[]; `project_ids`: `string`[]; \}; `error`: `boolean`; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `data`: \{ `chat_ids`: `string`[]; `document_ids`: `string`[]; `project_ids`: `string`[]; \}; `error`: `boolean`; \} | - |
| `200.data` | \{ `chat_ids`: `string`[]; `document_ids`: `string`[]; `project_ids`: `string`[]; \} | Identifiers affected by a recursive project soft deletion. |
| `200.data.chat_ids` | `string`[] | Deleted chats. |
| `200.data.document_ids` | `string`[] | Deleted documents. |
| `200.data.project_ids` | `string`[] | Deleted projects, including the requested root. |
| `200.error` | `boolean` | Indicates if an error occurred |
