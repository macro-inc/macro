# Type Alias: ExternalChatMessages

> **ExternalChatMessages** = \{ `messages`: [`ExternalChatMessage`](ExternalChatMessage.md)[]; `nextCursor?`: `string` \| `null`; \}

Newest-first timeline page; `before` is the last returned message id.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-messages"></a> `messages` | [`ExternalChatMessage`](ExternalChatMessage.md)[] | Messages in descending sent_at, id order. |
| <a id="property-nextcursor"></a> `nextCursor?` | `string` \| `null` | Cursor for older messages. |
