# Type Alias: ApiChannelListMessage

> **ApiChannelListMessage** = \{ `content`: `string`; `created_at`: `string`; `deleted_at?`: `string` \| `null`; `mentions`: `string`[]; `message_id`: `string`; `sender_id`: `string`; `thread_id?`: `string` \| `null`; `updated_at`: `string`; \}

Channel message in API responses.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `string` | Message content. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Deletion timestamp, if deleted. |
| <a id="property-mentions"></a> `mentions` | `string`[] | message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}` |
| <a id="property-message_id"></a> `message_id` | `string` | Message id. |
| <a id="property-sender_id"></a> `sender_id` | `string` | Sender user id. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Thread id, if the message is a reply. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Update timestamp. |
