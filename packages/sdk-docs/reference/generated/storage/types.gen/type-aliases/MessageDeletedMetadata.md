# Type Alias: MessageDeletedMetadata

> **MessageDeletedMetadata** = \{ `actor`: [`ChannelSender`](ChannelSender.md); `deleted_at?`: `string` \| `null`; `message_id`: `string`; `parent`: [`MessageParent`](MessageParent.md); `root_id`: `string`; `thread_id?`: `string` \| `null`; \}

A committed message tombstone.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor` | [`ChannelSender`](ChannelSender.md) | Actor that deleted the message; not necessarily the author. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Tombstone timestamp reported by the repository. |
| <a id="property-message_id"></a> `message_id` | `string` | The id of the deleted message. |
| <a id="property-parent"></a> `parent` | [`MessageParent`](MessageParent.md) | Entity that owns the message. |
| <a id="property-root_id"></a> `root_id` | `string` | Stable identity of the conversation. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root identifier for a reply; absent for a root. |
