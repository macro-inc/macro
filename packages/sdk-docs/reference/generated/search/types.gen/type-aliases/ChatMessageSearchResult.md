# Type Alias: ChatMessageSearchResult

> **ChatMessageSearchResult** = \{ `chat_message_id?`: `string` \| `null`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `role?`: `string` \| `null`; `score?`: `number` \| `null`; \}

A chat match for a given message id

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat_message_id"></a> `chat_message_id?` | `string` \| `null` | The chat message id for the chat This is only present if the search match was on the chat message content |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights for the chat message |
| <a id="property-role"></a> `role?` | `string` \| `null` | The role of the chat message This is only present if the search match was on the chat message content |
| <a id="property-score"></a> `score?` | `number` \| `null` | The score of the result |
