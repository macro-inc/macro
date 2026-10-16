# Type Alias: Message

> **Message** = \{ `attachments`: [`MessageAttachment`](MessageAttachment.md)[]; `bot_profile?`: `null` \| [`BotSenderProfile`](BotSenderProfile.md); `content`: `string`; `created_at`: `string`; `deleted_at?`: `string` \| `null`; `edited_at?`: `string` \| `null`; `id`: `string`; `imported_author?`: `null` \| [`ImportedAuthor`](ImportedAuthor.md); `mentions`: [`SimpleMention`](SimpleMention.md)[]; `parent`: [`MessageParent`](MessageParent.md); `reactions`: [`CountedReaction`](CountedReaction.md)[]; `sender_id`: `string`; `thread_id?`: `string` \| `null`; `triggered_by?`: `string` \| `null`; `updated_at`: `string`; \}

Shared message representation for channel timelines and entity discussions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`MessageAttachment`](MessageAttachment.md)[] | Attached entities. |
| <a id="property-bot_profile"></a> `bot_profile?` | `null` \| [`BotSenderProfile`](BotSenderProfile.md) | - |
| <a id="property-content"></a> `content` | `string` | Macro Markdown body. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation time. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Message tombstone, independent of thread deletion. |
| <a id="property-edited_at"></a> `edited_at?` | `string` \| `null` | Last content edit, if any. |
| <a id="property-id"></a> `id` | `string` | Message UUID. |
| <a id="property-imported_author"></a> `imported_author?` | `null` \| [`ImportedAuthor`](ImportedAuthor.md) | - |
| <a id="property-mentions"></a> `mentions` | [`SimpleMention`](SimpleMention.md)[] | Tracked mentions, retained when a caller changes attachments only. |
| <a id="property-parent"></a> `parent` | [`MessageParent`](MessageParent.md) | Entity that owns this conversation. |
| <a id="property-reactions"></a> `reactions` | [`CountedReaction`](CountedReaction.md)[] | Aggregated reactions. |
| <a id="property-sender_id"></a> `sender_id` | `string` | Authenticated actor or owner of imported content. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root message UUID for replies; absent on roots. |
| <a id="property-triggered_by"></a> `triggered_by?` | `string` \| `null` | User who triggered a bot-authored message. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Last persisted update. |
