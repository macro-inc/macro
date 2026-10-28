# Type Alias: MessagePatchedMetadata

> **MessagePatchedMetadata** = \{ `actor`: [`ChannelSender`](ChannelSender.md); `content`: `string`; `edited_at?`: `string` \| `null`; `message_id`: `string`; `parent`: [`MessageParent`](MessageParent.md); `root_id`: `string`; `thread_id?`: `string` \| `null`; `updated_at`: `string`; \}

A committed content edit.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor` | [`ChannelSender`](ChannelSender.md) | Actor that patched the message. |
| <a id="property-content"></a> `content` | `string` | Macro Markdown body after the patch. |
| <a id="property-edited_at"></a> `edited_at?` | `string` \| `null` | Edit timestamp, when the patch marked the message edited. |
| <a id="property-message_id"></a> `message_id` | `string` | The id of the patched message. |
| <a id="property-parent"></a> `parent` | [`MessageParent`](MessageParent.md) | Entity that owns the message. |
| <a id="property-root_id"></a> `root_id` | `string` | Stable identity of the conversation. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root identifier for a reply; absent for a root. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Update timestamp reported by the repository. |
