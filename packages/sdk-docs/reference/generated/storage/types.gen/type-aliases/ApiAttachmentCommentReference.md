# Type Alias: ApiAttachmentCommentReference

> **ApiAttachmentCommentReference** = \{ `attachment_created_at`: `string`; `message_content`: `string`; `message_created_at`: `string`; `message_id`: `string`; `parent_entity_id`: `string`; `parent_entity_type`: `string`; `sender_id`: `string`; `thread_id?`: `string` \| `null`; \}

A reference to an attachment entity from a comment on a non-channel entity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachment_created_at"></a> `attachment_created_at` | `string` | When the mention or attachment row was created. |
| <a id="property-message_content"></a> `message_content` | `string` | Full message content (might be used for preview/snippet). |
| <a id="property-message_created_at"></a> `message_created_at` | `string` | When the message itself was created. |
| <a id="property-message_id"></a> `message_id` | `string` | Message that contains the reference. |
| <a id="property-parent_entity_id"></a> `parent_entity_id` | `string` | Id of the entity the comment belongs to. |
| <a id="property-parent_entity_type"></a> `parent_entity_type` | `string` | Stored type of the entity the comment belongs to (`document`, `initiative`, `crm_company`, `crm_contact`, or `call`). |
| <a id="property-sender_id"></a> `sender_id` | `string` | Sender of the message. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | If the message belongs to a thread this is the parent id. |
