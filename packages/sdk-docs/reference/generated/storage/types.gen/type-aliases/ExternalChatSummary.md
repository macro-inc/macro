# Type Alias: ExternalChatSummary

> **ExternalChatSummary** = \{ `backfill?`: `null` \| [`ExternalChatBackfill`](ExternalChatBackfill.md); `canSend`: `boolean`; `community?`: `null` \| [`ExternalChatCommunity`](ExternalChatCommunity.md); `id`: `string`; `kind`: [`ExternalChatKind`](ExternalChatKind.md); `lastMessageAt?`: `string` \| `null`; `name`: `string`; `provider`: [`ExternalChatProvider`](ExternalChatProvider.md); `sendReason?`: `null` \| [`ExternalChatReplyBlock`](ExternalChatReplyBlock.md); `unreadCount`: `number`; `userId`: `string`; \}

An external chat visible through ordinary entity sharing.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backfill"></a> `backfill?` | `null` \| [`ExternalChatBackfill`](ExternalChatBackfill.md) | - |
| <a id="property-cansend"></a> `canSend` | `boolean` | Caller may currently send from their own account. |
| <a id="property-community"></a> `community?` | `null` \| [`ExternalChatCommunity`](ExternalChatCommunity.md) | - |
| <a id="property-id"></a> `id` | `string` | Entity identifier. |
| <a id="property-kind"></a> `kind` | [`ExternalChatKind`](ExternalChatKind.md) | A group, or a direct chat with one person (only its owner sends). |
| <a id="property-lastmessageat"></a> `lastMessageAt?` | `string` \| `null` | Latest message timestamp. |
| <a id="property-name"></a> `name` | `string` | Display name: the group's, or a direct chat's other person. |
| <a id="property-provider"></a> `provider` | [`ExternalChatProvider`](ExternalChatProvider.md) | The service the chat lives in. |
| <a id="property-sendreason"></a> `sendReason?` | `null` \| [`ExternalChatReplyBlock`](ExternalChatReplyBlock.md) | - |
| <a id="property-unreadcount"></a> `unreadCount` | `number` | Unread live messages for this viewer, counted up to [`UNREAD_COUNT_CAP`]. |
| <a id="property-userid"></a> `userId` | `string` | Actual entity owner. |
