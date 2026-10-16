# Type Alias: ValidateWebhookErrors

> **ValidateWebhookErrors** = \{ `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `429`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | Forbidden |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | Webhook not found |
| <a id="property-429"></a> `429` | [`ErrorResponse`](ErrorResponse.md) | Rate limited |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | Internal server error |
