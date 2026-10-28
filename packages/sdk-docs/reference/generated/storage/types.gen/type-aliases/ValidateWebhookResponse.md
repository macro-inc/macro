# Type Alias: ValidateWebhookResponse

> **ValidateWebhookResponse** = \{ `is_valid`: `boolean`; `message?`: `string` \| `null`; `response_status?`: `number` \| `null`; `webhook_id`: [`String`](String.md); \}

Sanitized result of validating a webhook endpoint.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-is_valid"></a> `is_valid` | `boolean` | Whether the endpoint accepted the signed validation delivery. |
| <a id="property-message"></a> `message?` | `string` \| `null` | Sanitized message explaining validation failure. |
| <a id="property-response_status"></a> `response_status?` | `number` \| `null` | HTTP response status returned by the webhook endpoint, when available. |
| <a id="property-webhook_id"></a> `webhook_id` | [`String`](String.md) | Webhook id that was validated. |
