# Type Alias: MetaSendProgress

> **MetaSendProgress** = \{ `channel_id`: `string`; `created_at`: `string`; `error_code?`: `string` \| `null`; `id`: `string`; `message_id?`: `string` \| `null`; `payload`: [`MetaSendReply`](MetaSendReply.md); `state`: [`MetaDeliveryState`](MetaDeliveryState.md); `user_id`: `string`; \}

Durable result of an intentional send; accepted does not mean delivered.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Native conversation. |
| <a id="property-created_at"></a> `created_at` | `string` | Intent creation time. |
| <a id="property-error_code"></a> `error_code?` | `string` \| `null` | Sanitized rejection/recovery code. |
| <a id="property-id"></a> `id` | `string` | Stable local intent ID. |
| <a id="property-message_id"></a> `message_id?` | `string` \| `null` | Linked native message, when created. |
| <a id="property-payload"></a> `payload` | [`MetaSendReply`](MetaSendReply.md) | Retained intent for recovering a failed draft without inventing content. |
| <a id="property-state"></a> `state` | [`MetaDeliveryState`](MetaDeliveryState.md) | Current delivery observation. |
| <a id="property-user_id"></a> `user_id` | `string` | Human who explicitly submitted this reply. |
