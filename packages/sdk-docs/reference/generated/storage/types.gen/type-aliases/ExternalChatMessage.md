# Type Alias: ExternalChatMessage

> **ExternalChatMessage** = \{ `attachments`: [`ExternalChatAttachment`](ExternalChatAttachment.md)[]; `body`: `string`; `deleted`: `boolean`; `deliveryState?`: `null` \| [`ExternalChatDeliveryState`](ExternalChatDeliveryState.md); `editedAt?`: `string` \| `null`; `forwarded`: `boolean`; `id`: `string`; `kind`: [`ExternalChatMessageKind`](ExternalChatMessageKind.md); `mentions`: [`ExternalChatMention`](ExternalChatMention.md)[]; `reactions`: [`ExternalChatReaction`](ExternalChatReaction.md)[]; `receivedAt`: `string`; `replyTo?`: `string` \| `null`; `rich?`: `null` \| [`ExternalChatRichContent`](ExternalChatRichContent.md); `sender`: [`ExternalChatSender`](ExternalChatSender.md); `sentAt`: `string`; `viewOnce`: `boolean`; \}

One message in an external chat.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`ExternalChatAttachment`](ExternalChatAttachment.md)[] | Imported or pending attachments. |
| <a id="property-body"></a> `body` | `string` | Plain text. |
| <a id="property-deleted"></a> `deleted` | `boolean` | Deleted for everyone. |
| <a id="property-deliverystate"></a> `deliveryState?` | `null` \| [`ExternalChatDeliveryState`](ExternalChatDeliveryState.md) | - |
| <a id="property-editedat"></a> `editedAt?` | `string` \| `null` | Last edit timestamp. |
| <a id="property-forwarded"></a> `forwarded` | `boolean` | Forwarded from another chat. |
| <a id="property-id"></a> `id` | `string` | Stable message id. |
| <a id="property-kind"></a> `kind` | [`ExternalChatMessageKind`](ExternalChatMessageKind.md) | A message, or a system line. |
| <a id="property-mentions"></a> `mentions` | [`ExternalChatMention`](ExternalChatMention.md)[] | People the body @-mentions. |
| <a id="property-reactions"></a> `reactions` | [`ExternalChatReaction`](ExternalChatReaction.md)[] | Reactions grouped by emoji. |
| <a id="property-receivedat"></a> `receivedAt` | `string` | Timestamp first received by Macro. |
| <a id="property-replyto"></a> `replyTo?` | `string` \| `null` | Message quoted by this one. |
| <a id="property-rich"></a> `rich?` | `null` \| [`ExternalChatRichContent`](ExternalChatRichContent.md) | - |
| <a id="property-sender"></a> `sender` | [`ExternalChatSender`](ExternalChatSender.md) | Sender. |
| <a id="property-sentat"></a> `sentAt` | `string` | Timestamp assigned by the provider. |
| <a id="property-viewonce"></a> `viewOnce` | `boolean` | Sent as view-once; Macro shows it like any media. |
