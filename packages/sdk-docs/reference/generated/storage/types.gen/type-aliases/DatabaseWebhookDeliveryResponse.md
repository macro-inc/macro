# Type Alias: DatabaseWebhookDeliveryResponse

> **DatabaseWebhookDeliveryResponse** = \{ `databaseId`: `string`; `rows`: `string`[]; `tableId`: `string`; \}

The rows a webhook call inserted.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-databaseid"></a> `databaseId` | `string` | The database. |
| <a id="property-rows"></a> `rows` | `string`[] | The new rows, in the order the payload sent them. |
| <a id="property-tableid"></a> `tableId` | `string` | The table. |
