# Type Alias: RejectToolCallRequest

> **RejectToolCallRequest** = \{ `messageId`: `string`; `toolCallId`: `string`; \}

Request body for rejecting a pending tool call.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-messageid"></a> `messageId` | `string` | The message ID containing the tool call. |
| <a id="property-toolcallid"></a> `toolCallId` | `string` | The tool call ID to reject. |
