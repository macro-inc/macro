# Type Alias: LinkedSendProgress

> **LinkedSendProgress** = \{ `created_at`: `string`; `error_code?`: `string` \| `null`; `group_id`: `string`; `id`: `string`; `message_id?`: `string` \| `null`; `payload`: [`LinkedSendReply`](LinkedSendReply.md); `state`: [`LinkedDeliveryState`](LinkedDeliveryState.md); `user_id`: `string`; \}

Durable result of a deliberate send.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | Intent creation time. |
| <a id="property-error_code"></a> `error_code?` | `string` \| `null` | Sanitized failure code. |
| <a id="property-group_id"></a> `group_id` | `string` | Group entity. |
| <a id="property-id"></a> `id` | `string` | Stable intent id. |
| <a id="property-message_id"></a> `message_id?` | `string` \| `null` | Group message, once WhatsApp accepted it. |
| <a id="property-payload"></a> `payload` | [`LinkedSendReply`](LinkedSendReply.md) | The original request, so a failed draft can be recovered. |
| <a id="property-state"></a> `state` | [`LinkedDeliveryState`](LinkedDeliveryState.md) | Current state. |
| <a id="property-user_id"></a> `user_id` | `string` | Person who submitted it. |
