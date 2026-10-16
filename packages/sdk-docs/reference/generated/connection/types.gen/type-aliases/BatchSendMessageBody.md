# Type Alias: BatchSendMessageBody

> **BatchSendMessageBody** = \{ `entities`: [`Entity`](Entity.md)[]; `message`: `unknown`; `message_type`: `string`; \}

The body of a batch send message request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entities"></a> `entities` | [`Entity`](Entity.md)[] | all entities to send the message to |
| <a id="property-message"></a> `message` | `unknown` | the message to send |
| <a id="property-message_type"></a> `message_type` | `string` | the type of the message we are sending |
