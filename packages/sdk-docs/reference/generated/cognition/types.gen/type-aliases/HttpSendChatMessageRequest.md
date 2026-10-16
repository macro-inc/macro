# Type Alias: HttpSendChatMessageRequest

> **HttpSendChatMessageRequest** = \{ `additional_instructions?`: `string` \| `null`; `attachments?`: [`Entity`](Entity.md)[] \| `null`; `chat_id?`: `string` \| `null`; `content`: `string`; `model`: `string`; `speed?`: [`ModelSpeed`](ModelSpeed.md); `toolset?`: [`ToolSet`](ToolSet.md); \}

HTTP request payload for sending a chat message.
Unlike the WebSocket payload, this does not include stream_id as it's generated server-side.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-additional_instructions"></a> `additional_instructions?` | `string` \| `null` | Additional system instructions appended to the base system prompt |
| <a id="property-attachments"></a> `attachments?` | [`Entity`](Entity.md)[] \| `null` | Attachments for the message |
| <a id="property-chat_id"></a> `chat_id?` | `string` \| `null` | Id of the chat the message belongs to (optional - if not provided, a new chat is created) |
| <a id="property-content"></a> `content` | `string` | The content of the message |
| <a id="property-model"></a> `model` | `string` | The model to respond with (`provider/model` id) |
| <a id="property-speed"></a> `speed?` | [`ModelSpeed`](ModelSpeed.md) | Inference speed, validated against the selected model. Defaults to standard. |
| <a id="property-toolset"></a> `toolset?` | [`ToolSet`](ToolSet.md) | Which toolset to use. Defaults to `all` |
