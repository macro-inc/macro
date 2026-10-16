# Type Alias: ChatMessage

> **ChatMessage** = \{ `content`: [`ChatMessageContent`](ChatMessageContent.md); `id`: `string`; `model?`: `string` \| `null`; `role`: [`Role`](Role.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | [`ChatMessageContent`](ChatMessageContent.md) | Message content |
| <a id="property-id"></a> `id` | `string` | The chat message id |
| <a id="property-model"></a> `model?` | `string` \| `null` | the model used to generate the message |
| <a id="property-role"></a> `role` | [`Role`](Role.md) | Whether the chat is from the user or system |
