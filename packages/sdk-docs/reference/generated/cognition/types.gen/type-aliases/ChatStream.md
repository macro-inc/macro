# Type Alias: ChatStream

> **ChatStream** = [`StreamError`](StreamError.md) & \{ `type`: `"error"`; \} \| \{ `attachments`: [`Entity`](Entity.md)[]; `chat_id`: `string`; `content`: `string`; `message_id`: `string`; `stream_id`: `string`; `type`: `"chat_user_message"`; \} \| \{ `chat_id`: `string`; `content`: [`AssistantMessagePart`](AssistantMessagePart.md); `message_id`: `string`; `stream_id`: `string`; `type`: `"chat_message_response"`; \} \| \{ `stream_id`: `string`; `type`: `"stream_end"`; \}
