# Type Alias: ChannelSearchResult

> **ChannelSearchResult** = \{ `created_at?`: `string` \| `null`; `deleted_at?`: `string` \| `null`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `message_id?`: `string` \| `null`; `score?`: `number` \| `null`; `sender_id?`: `string` \| `null`; `thread_id?`: `string` \| `null`; `updated_at?`: `string` \| `null`; \}

A channel message match for a given channel id

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at?` | `string` \| `null` | When the channel message was created This is only prsent if the search result is on the message content |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | When the channel message was deleted, if it has been |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights for the channel message |
| <a id="property-message_id"></a> `message_id?` | `string` \| `null` | The channel message id This is only prsent if the search result is on the message content |
| <a id="property-score"></a> `score?` | `number` \| `null` | The score of the result |
| <a id="property-sender_id"></a> `sender_id?` | `string` \| `null` | The sender id This is only prsent if the search result is on the message content |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | The channel message thread id |
| <a id="property-updated_at"></a> `updated_at?` | `string` \| `null` | When the channel message was last updated This is only prsent if the search result is on the message content |
