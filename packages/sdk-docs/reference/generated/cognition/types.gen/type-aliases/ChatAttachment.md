# Type Alias: ChatAttachment

> **ChatAttachment** = \{ `attachment_id`: `string`; `attachment_type`: [`AttachmentType`](AttachmentType.md); `chat_id?`: `string` \| `null`; `id`: `string`; `message_id?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachment_id"></a> `attachment_id` | `string` | The id of the attachment either a `document_id` or `project_id` or `chat_id` |
| <a id="property-attachment_type"></a> `attachment_type` | [`AttachmentType`](AttachmentType.md) | The type of attachment |
| <a id="property-chat_id"></a> `chat_id?` | `string` \| `null` | The id of the chat if the attachment is a chat |
| <a id="property-id"></a> `id` | `string` | db attachment id - unused |
| <a id="property-message_id"></a> `message_id?` | `string` \| `null` | The id of the message if the attachment is a message |
