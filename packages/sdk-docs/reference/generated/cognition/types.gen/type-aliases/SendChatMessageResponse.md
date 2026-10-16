# Type Alias: SendChatMessageResponse

> **SendChatMessageResponse** = \{ `chat_id`: `string`; `message_id`: `string`; `stream_id`: `string`; \}

Response for initiating a chat message stream

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat_id"></a> `chat_id` | `string` | The chat ID (may differ from request if a new chat was created) |
| <a id="property-message_id"></a> `message_id` | `string` | The message ID for the AI response |
| <a id="property-stream_id"></a> `stream_id` | `string` | The stream ID that will receive the response chunks (same as message_id) |
