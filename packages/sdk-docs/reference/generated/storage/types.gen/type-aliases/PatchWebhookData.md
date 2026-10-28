# Type Alias: PatchWebhookData

> **PatchWebhookData** = \{ `body`: [`PatchWebhookRequest`](PatchWebhookRequest.md); `path`: \{ `webhook_id`: `string`; \}; `query?`: `never`; `url`: `"/webhook/webhooks/{webhook_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`PatchWebhookRequest`](PatchWebhookRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `webhook_id`: `string`; \} | - |
| `path.webhook_id` | `string` | Webhook id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/webhook/webhooks/{webhook_id}"` | - |
