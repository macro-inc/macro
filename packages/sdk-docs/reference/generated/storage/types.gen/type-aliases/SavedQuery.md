# Type Alias: SavedQuery

> **SavedQuery** = \{ `createdAt`: `string`; `createdBy`: `string` \| `null`; `databaseId`: `string` \| `null`; `definition`: [`QueryDefinition`](QueryDefinition.md); `id`: `string`; \}

A stored, immutable query. Editing a question saves a new one.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was saved. |
| <a id="property-createdby"></a> `createdBy` | `string` \| `null` | Who saved it; `null` once that user is deleted. |
| <a id="property-databaseid"></a> `databaseId` | `string` \| `null` | The database whose tables win name resolution; `null` once that database is deleted, or when none was given. |
| <a id="property-definition"></a> `definition` | [`QueryDefinition`](QueryDefinition.md) | What it asks. |
| <a id="property-id"></a> `id` | `string` | Identifier. |
