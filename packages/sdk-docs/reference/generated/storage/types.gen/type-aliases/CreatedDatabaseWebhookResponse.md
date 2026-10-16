# Type Alias: CreatedDatabaseWebhookResponse

> **CreatedDatabaseWebhookResponse** = \{ `token`: `string`; `webhook`: [`DatabaseWebhookResponse`](DatabaseWebhookResponse.md); \}

A new webhook, with the token its URL carries. The token is shown only
here.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-token"></a> `token` | `string` | The secret: `POST /databases/webhooks/{token}` inserts rows. |
| <a id="property-webhook"></a> `webhook` | [`DatabaseWebhookResponse`](DatabaseWebhookResponse.md) | The webhook. |
