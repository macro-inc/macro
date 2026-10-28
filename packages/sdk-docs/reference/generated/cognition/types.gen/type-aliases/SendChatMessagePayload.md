# Type Alias: SendChatMessagePayload

> **SendChatMessagePayload** = [`JwtPayload`](JwtPayload.md) & \{ `additional_instructions?`: `string` \| `null`; `attachments?`: [`Entity`](Entity.md)[] \| `null`; `chat_id`: `string`; `content`: `string`; `model`: `string`; `stream_id`: `string`; `toolset?`: [`ToolSet`](ToolSet.md); \}

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `additional_instructions?` | `string` \| `null` | Additional system instructions appended to the base system prompt |
| `attachments?` | [`Entity`](Entity.md)[] \| `null` | Use citation prompt |
| `chat_id` | `string` | Id of the chat the message belongs to |
| `content` | `string` | The content of the message |
| `model` | `string` | the chat model to respond with (`provider/model` id) |
| `stream_id` | `string` | Stream ID for tracking the response |
| `toolset?` | [`ToolSet`](ToolSet.md) | Which toolset to use. Defaults to `all` |
