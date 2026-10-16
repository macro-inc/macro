# Type Alias: SendMessageHandlerData

> **SendMessageHandlerData** = \{ `body`: [`SendMessageBody`](SendMessageBody.md); `path`: \{ `entity_id`: `string`; `entity_type`: `string`; \}; `query?`: `never`; `url`: `"/message/send/{entity_type}/{entity_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SendMessageBody`](SendMessageBody.md) | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: `string`; \} | - |
| `path.entity_id` | `string` | the id of the entity to send the message to |
| `path.entity_type` | `string` | the type of the entity to send the msssage to e.g. "user" \| "channel" \| "document" etc... |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/message/send/{entity_type}/{entity_id}"` | - |
