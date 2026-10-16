# Type Alias: ChannelMessageSearchResponseItem

> **ChannelMessageSearchResponseItem** = \{ `channel_id`: `string`; `channel_type`: `string`; `created_at`: `string`; `deleted_at?`: `string` \| `null`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `id`: `string`; `message_id`: `string`; `owner_id?`: `string` \| `null`; `score?`: `number` \| `null`; `sender_id`: `string`; `thread_id?`: `string` \| `null`; `updated_at`: `string`; \}

A single channel-message content hit in the unified search response.
One item per matching message, timestamped by the message itself, so the
unified sort interleaves channel messages with other entity types by
their own recency.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | The id of the channel the message belongs to |
| <a id="property-channel_type"></a> `channel_type` | `string` | The type of channel |
| <a id="property-created_at"></a> `created_at` | `string` | When the channel message was created |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | When the channel message was deleted, if it has been |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights for the channel message |
| <a id="property-id"></a> `id` | `string` | Standardized id field shared by all item types; the channel id. |
| <a id="property-message_id"></a> `message_id` | `string` | The channel message id |
| <a id="property-owner_id"></a> `owner_id?` | `string` \| `null` | we don't store this for channels atm but keeping it here for consistency |
| <a id="property-score"></a> `score?` | `number` \| `null` | The score of the result |
| <a id="property-sender_id"></a> `sender_id` | `string` | The sender id |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | The channel message thread id |
| <a id="property-updated_at"></a> `updated_at` | `string` | When the channel message was last updated |
