# Type Alias: MessagePostedMetadata

> **MessagePostedMetadata** = \{ `attachments`: [`MessageEventAttachment`](MessageEventAttachment.md)[]; `content`: `string`; `created_at`: `string`; `mentions`: [`SimpleMention`](SimpleMention.md)[]; `message_id`: `string`; `parent`: [`MessageParent`](MessageParent.md); `root_id`: `string`; `sender`: [`ChannelSender`](ChannelSender.md); `thread_id?`: `string` \| `null`; `triggered_by?`: `string` \| `null`; \}

A committed post, independent of the surface presenting the conversation.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`MessageEventAttachment`](MessageEventAttachment.md)[] | Persisted attachments available to authorized consumers. |
| <a id="property-content"></a> `content` | `string` | Macro Markdown body. |
| <a id="property-created_at"></a> `created_at` | `string` | Message creation timestamp. |
| <a id="property-mentions"></a> `mentions` | [`SimpleMention`](SimpleMention.md)[] | Explicit mentions recorded with the post. |
| <a id="property-message_id"></a> `message_id` | `string` | Posted message identifier. |
| <a id="property-parent"></a> `parent` | [`MessageParent`](MessageParent.md) | Entity that owns the message and determines access to it. |
| <a id="property-root_id"></a> `root_id` | `string` | Stable identity of the conversation, shared by roots and replies. |
| <a id="property-sender"></a> `sender` | [`ChannelSender`](ChannelSender.md) | Author, including bot principals. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root identifier for a reply; absent for a new root. |
| <a id="property-triggered_by"></a> `triggered_by?` | `string` \| `null` | User whose invocation produced a bot response. |
