# Type Alias: ChannelMessage

> **ChannelMessage** = \{ `content`: `string`; `created_at`: `string`; `deleted_at?`: `string` \| `null`; `mentions`: `string`[]; `message_id`: `string`; `sender_id`: `string`; `thread_id?`: `string` \| `null`; `updated_at`: `string`; \}

Lightweight channel message for soup payloads.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `string` | Message content. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Deletion timestamp. |
| <a id="property-mentions"></a> `mentions` | `string`[] | Message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}`. |
| <a id="property-message_id"></a> `message_id` | `string` | Message id. |
| <a id="property-sender_id"></a> `sender_id` | `string` | Sender id. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Thread parent id. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Update timestamp. |
