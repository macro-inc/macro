# Type Alias: MessageAttachmentRemovedMetadata

> **MessageAttachmentRemovedMetadata** = \{ `actor`: [`ChannelSender`](ChannelSender.md); `attachments`: [`MessageEventAttachment`](MessageEventAttachment.md)[]; `message_id`: `string`; `parent`: [`MessageParent`](MessageParent.md); `root_id`: `string`; `thread_id?`: `string` \| `null`; \}

Attachments removed from a message by an edit.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor` | [`ChannelSender`](ChannelSender.md) | Actor that removed the attachments. |
| <a id="property-attachments"></a> `attachments` | [`MessageEventAttachment`](MessageEventAttachment.md)[] | Attachments removed by this mutation. |
| <a id="property-message_id"></a> `message_id` | `string` | Message the attachments were removed from. |
| <a id="property-parent"></a> `parent` | [`MessageParent`](MessageParent.md) | Entity that owns the message. |
| <a id="property-root_id"></a> `root_id` | `string` | Stable identity of the conversation. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root identifier for a reply; absent for a root. |
