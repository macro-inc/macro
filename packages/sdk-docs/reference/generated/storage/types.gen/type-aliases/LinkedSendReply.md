# Type Alias: LinkedSendReply

> **LinkedSendReply** = \{ `idempotency_key`: `string`; `message`: [`LinkedReplyContent`](LinkedReplyContent.md); `reply_to?`: `string` \| `null`; \}

Explicit send action from a person. Only deliberate sends reach WhatsApp.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-idempotency_key"></a> `idempotency_key` | `string` | Stable client intent key. A changed payload with this key is a conflict. |
| <a id="property-message"></a> `message` | [`LinkedReplyContent`](LinkedReplyContent.md) | Content. |
| <a id="property-reply_to"></a> `reply_to?` | `string` \| `null` | Group message being quoted, within this group. |
