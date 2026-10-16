# Type Alias: ProjectDeleteResponseData

> **ProjectDeleteResponseData** = \{ `chat_ids`: `string`[]; `document_ids`: `string`[]; `project_ids`: `string`[]; \}

Identifiers affected by a recursive project soft deletion.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat_ids"></a> `chat_ids` | `string`[] | Deleted chats. |
| <a id="property-document_ids"></a> `document_ids` | `string`[] | Deleted documents. |
| <a id="property-project_ids"></a> `project_ids` | `string`[] | Deleted projects, including the requested root. |
