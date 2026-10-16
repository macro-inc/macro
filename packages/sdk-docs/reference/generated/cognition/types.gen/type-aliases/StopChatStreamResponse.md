# Type Alias: StopChatStreamResponse

> **StopChatStreamResponse** = \{ `stopped`: `boolean`; \}

Response from a stop request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-stopped"></a> `stopped` | `boolean` | `true` if a matching in-flight stream was found and cancellation was triggered, `false` if the stream had already finished or was unknown. |
