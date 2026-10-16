# Type Alias: DeleteDatabaseWebhookData

> **DeleteDatabaseWebhookData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; `webhook_id`: `string`; \}; `query?`: `never`; `url`: `"/databases/{id}/webhooks/{webhook_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; `webhook_id`: `string`; \} | - |
| `path.id` | `string` | Database id |
| `path.webhook_id` | `string` | Webhook id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/databases/{id}/webhooks/{webhook_id}"` | - |
