# Type Alias: SoupChannelThread

> **SoupChannelThread** = \{ `attachments`: [`SoupMessageAttachment`](SoupMessageAttachment.md)[]; `channel_id`: `string`; `content`: `string`; `created_at`: `string`; `deleted_at?`: `string` \| `null`; `edited_at?`: `string` \| `null`; `id`: `string`; `reactions`: [`SoupCountedReaction`](SoupCountedReaction.md)[]; `sender`: [`SoupMessageSender`](SoupMessageSender.md); `sender_id`: `string`; `thread`: [`SoupThreadInfo`](SoupThreadInfo.md); `updated_at`: `string`; \}

A top-level channel message thread for soup payloads.

This mirrors the public channel-message API shape so soup consumers can
render a thread root the same way they render a channel timeline message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`SoupMessageAttachment`](SoupMessageAttachment.md)[] | Attachments on this message. |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel id. |
| <a id="property-content"></a> `content` | `string` | Message content. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Deletion timestamp. |
| <a id="property-edited_at"></a> `edited_at?` | `string` \| `null` | Edit timestamp. |
| <a id="property-id"></a> `id` | `string` | Message id. |
| <a id="property-reactions"></a> `reactions` | [`SoupCountedReaction`](SoupCountedReaction.md)[] | Reactions on this message. |
| <a id="property-sender"></a> `sender` | [`SoupMessageSender`](SoupMessageSender.md) | Structured sender identity. |
| <a id="property-sender_id"></a> `sender_id` | `string` | Sender id. |
| <a id="property-thread"></a> `thread` | [`SoupThreadInfo`](SoupThreadInfo.md) | Thread metadata and preview replies. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Update timestamp. |
