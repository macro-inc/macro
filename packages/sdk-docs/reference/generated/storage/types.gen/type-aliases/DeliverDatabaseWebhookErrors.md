# Type Alias: DeliverDatabaseWebhookErrors

> **DeliverDatabaseWebhookErrors** = \{ `400`: [`InvalidDatabaseWebhookPayloadResponse`](InvalidDatabaseWebhookPayloadResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`InvalidDatabaseWebhookPayloadResponse`](InvalidDatabaseWebhookPayloadResponse.md) | The payload does not fit the table; nothing was written |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | The webhook's creator can no longer edit the database |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | No such webhook |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
