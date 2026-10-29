# Type Alias: UpdateToolResponseRequest

> **UpdateToolResponseRequest** = \{ `messageId`: `string`; `response`: [`UserToolResponseValue`](UserToolResponseValue.md); `toolCallId`: `string`; \}

Request body for updating a tool response.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-messageid"></a> `messageId` | `string` | The message ID containing the tool response. |
| <a id="property-response"></a> `response` | [`UserToolResponseValue`](UserToolResponseValue.md) | The new user tool response. |
| <a id="property-toolcallid"></a> `toolCallId` | `string` | The tool call ID whose response should be updated. |
