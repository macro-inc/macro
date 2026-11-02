# Type Alias: ExternalChatMessageMetadata

> **ExternalChatMessageMetadata** = \{ `chatName`: `string`; `messageId`: `string`; `provider`: [`ExternalChatProvider`](ExternalChatProvider.md); \}

A live message in an independently shared external chat.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chatname"></a> `chatName` | `string` | The chat's name. |
| <a id="property-messageid"></a> `messageId` | `string` | Stable message id; retries use it as their notification id. |
| <a id="property-provider"></a> `provider` | [`ExternalChatProvider`](ExternalChatProvider.md) | The messaging service the chat lives in. |
