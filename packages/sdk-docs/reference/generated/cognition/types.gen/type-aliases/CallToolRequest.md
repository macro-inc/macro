# Type Alias: CallToolRequest

> **CallToolRequest** = \{ `args?`: `unknown`; `messageId`: `string`; `toolCallId`: `string`; \}

Request body for executing a pending tool call.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-args"></a> `args?` | `unknown` | Optional updated arguments. Uses original args if omitted. |
| <a id="property-messageid"></a> `messageId` | `string` | The message ID containing the tool call. |
| <a id="property-toolcallid"></a> `toolCallId` | `string` | The tool call ID to execute. |
