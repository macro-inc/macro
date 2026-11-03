# Type Alias: ExternalChatSendReply

> **ExternalChatSendReply** = \{ `idempotencyKey`: `string`; `message`: [`ExternalChatReplyContent`](ExternalChatReplyContent.md); `replyTo?`: `string` \| `null`; \}

Explicit send action from a person. Only deliberate sends reach WhatsApp.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-idempotencykey"></a> `idempotencyKey` | `string` | Stable client intent key. A changed payload with this key is a conflict. |
| <a id="property-message"></a> `message` | [`ExternalChatReplyContent`](ExternalChatReplyContent.md) | Content. |
| <a id="property-replyto"></a> `replyTo?` | `string` \| `null` | Message being quoted, within this chat. |
