# Type Alias: ExternalChatMessagesData

> **ExternalChatMessagesData** = \{ `body?`: `never`; `path`: \{ `chat_id`: `string`; \}; `query?`: \{ `before?`: `string` \| `null`; `limit?`: `number` \| `null`; \}; `url`: `"/external-chats/{chat_id}/messages"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `chat_id`: `string`; \} | - |
| `path.chat_id` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `before?`: `string` \| `null`; `limit?`: `number` \| `null`; \} | - |
| `query.before?` | `string` \| `null` | Last message id in the previous page. |
| `query.limit?` | `number` \| `null` | Page size, up to [`PAGE_LIMIT`]; [`DEFAULT_PAGE`] when absent. |
| <a id="property-url"></a> `url` | `"/external-chats/{chat_id}/messages"` | - |
