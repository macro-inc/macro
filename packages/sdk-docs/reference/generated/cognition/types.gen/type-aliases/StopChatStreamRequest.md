# Type Alias: StopChatStreamRequest

> **StopChatStreamRequest** = \{ `chat_id`: `string`; `stream_id`: `string`; \}

Request body for stopping an in-flight chat stream.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat_id"></a> `chat_id` | `string` | The chat the stream belongs to. Used to verify the caller has permission to stop the stream. |
| <a id="property-stream_id"></a> `stream_id` | `string` | The stream/message ID to stop. |
