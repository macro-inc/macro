# Type Alias: WhatsAppGroupMessage

> **WhatsAppGroupMessage** = \{ `attachments`: [`LinkedAttachment`](LinkedAttachment.md)[]; `body`: `string`; `deleted`: `boolean`; `delivery_state?`: `null` \| [`LinkedDeliveryState`](LinkedDeliveryState.md); `edited_at?`: `string` \| `null`; `forwarded`: `boolean`; `id`: `string`; `kind`: [`WhatsAppMessageKind`](WhatsAppMessageKind.md); `mentions`: [`WhatsAppMention`](WhatsAppMention.md)[]; `reactions`: [`WhatsAppGroupReaction`](WhatsAppGroupReaction.md)[]; `received_at`: `string`; `reply_to?`: `string` \| `null`; `rich?`: `null` \| [`WhatsAppRichContent`](WhatsAppRichContent.md); `sender`: [`WhatsAppGroupSender`](WhatsAppGroupSender.md); `sent_at`: `string`; `view_once`: `boolean`; \}

One message in an adopted group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`LinkedAttachment`](LinkedAttachment.md)[] | Imported or pending attachments. |
| <a id="property-body"></a> `body` | `string` | Plain WhatsApp text. |
| <a id="property-deleted"></a> `deleted` | `boolean` | Deleted for everyone. |
| <a id="property-delivery_state"></a> `delivery_state?` | `null` \| [`LinkedDeliveryState`](LinkedDeliveryState.md) | - |
| <a id="property-edited_at"></a> `edited_at?` | `string` \| `null` | Last edit timestamp. |
| <a id="property-forwarded"></a> `forwarded` | `boolean` | Forwarded from another chat. |
| <a id="property-id"></a> `id` | `string` | Stable message id. |
| <a id="property-kind"></a> `kind` | [`WhatsAppMessageKind`](WhatsAppMessageKind.md) | A message, or a system line. |
| <a id="property-mentions"></a> `mentions` | [`WhatsAppMention`](WhatsAppMention.md)[] | People the body @-mentions. |
| <a id="property-reactions"></a> `reactions` | [`WhatsAppGroupReaction`](WhatsAppGroupReaction.md)[] | Reactions grouped by emoji. |
| <a id="property-received_at"></a> `received_at` | `string` | Timestamp first received by Macro. |
| <a id="property-reply_to"></a> `reply_to?` | `string` \| `null` | Message quoted by this one. |
| <a id="property-rich"></a> `rich?` | `null` \| [`WhatsAppRichContent`](WhatsAppRichContent.md) | - |
| <a id="property-sender"></a> `sender` | [`WhatsAppGroupSender`](WhatsAppGroupSender.md) | Sender. |
| <a id="property-sent_at"></a> `sent_at` | `string` | Timestamp assigned by WhatsApp. |
| <a id="property-view_once"></a> `view_once` | `boolean` | Sent as view-once in WhatsApp; Macro shows it like any media. |
