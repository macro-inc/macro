# Type Alias: DatabaseWebhookResponse

> **DatabaseWebhookResponse** = \{ `createdAt`: `string`; `createdBy`: `string`; `databaseId`: `string`; `id`: `string`; `tableId`: `string`; `tokenPrefix`: `string`; \}

A webhook of a database. Its token is never shown again after creation.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | Creation time. |
| <a id="property-createdby"></a> `createdBy` | `string` | Who created it; its calls write with their access. |
| <a id="property-databaseid"></a> `databaseId` | `string` | The database. |
| <a id="property-id"></a> `id` | `string` | Identifier. |
| <a id="property-tableid"></a> `tableId` | `string` | The table its calls insert rows into. |
| <a id="property-tokenprefix"></a> `tokenPrefix` | `string` | The token's first characters, to tell webhooks apart. |
