# Type Alias: ApiAttachmentChannelReference

> **ApiAttachmentChannelReference** = \{ `attachment_created_at`: `string`; `channel_id`: `string`; `channel_name?`: `string` \| `null`; `message_content`: `string`; `message_created_at`: `string`; `message_id`: `string`; `sender_id`: `string`; `thread_id?`: `string` \| `null`; \}

A reference to an attachment entity from a channel message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachment_created_at"></a> `attachment_created_at` | `string` | When the attachment row was created. |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel that contains the message. |
| <a id="property-channel_name"></a> `channel_name?` | `string` \| `null` | Optional channel name (DMs do not have a name). |
| <a id="property-message_content"></a> `message_content` | `string` | Full message content (might be used for preview/snippet). |
| <a id="property-message_created_at"></a> `message_created_at` | `string` | When the message itself was created. |
| <a id="property-message_id"></a> `message_id` | `string` | Message that contains the attachment reference. |
| <a id="property-sender_id"></a> `sender_id` | `string` | Sender of the message. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | If the message belongs to a thread this is the parent id. |
