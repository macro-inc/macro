# Type Alias: ExternalChatSendProgress

> **ExternalChatSendProgress** = \{ `chatId`: `string`; `createdAt`: `string`; `errorCode?`: `string` \| `null`; `id`: `string`; `messageId?`: `string` \| `null`; `payload`: [`ExternalChatSendReply`](ExternalChatSendReply.md); `state`: [`ExternalChatDeliveryState`](ExternalChatDeliveryState.md); `userId`: `string`; \}

Durable result of a deliberate send.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chatid"></a> `chatId` | `string` | External chat. |
| <a id="property-createdat"></a> `createdAt` | `string` | Intent creation time. |
| <a id="property-errorcode"></a> `errorCode?` | `string` \| `null` | Sanitized failure code. |
| <a id="property-id"></a> `id` | `string` | Stable intent id. |
| <a id="property-messageid"></a> `messageId?` | `string` \| `null` | The chat's message, once the provider accepted it. |
| <a id="property-payload"></a> `payload` | [`ExternalChatSendReply`](ExternalChatSendReply.md) | The original request, so a failed draft can be recovered. |
| <a id="property-state"></a> `state` | [`ExternalChatDeliveryState`](ExternalChatDeliveryState.md) | Current state. |
| <a id="property-userid"></a> `userId` | `string` | Person who submitted it. |
