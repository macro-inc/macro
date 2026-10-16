# Type Alias: StartFreshAgentConversationData

> **StartFreshAgentConversationData** = \{ `body`: [`StartFreshAgentConversationRequest`](StartFreshAgentConversationRequest.md); `path`: \{ `bot_id`: `string`; `channel_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-conversations/{channel_id}/{bot_id}/start-fresh"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`StartFreshAgentConversationRequest`](StartFreshAgentConversationRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `bot_id`: `string`; `channel_id`: `string`; \} | - |
| `path.bot_id` | `string` | Persona the conversation is with |
| `path.channel_id` | `string` | - |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-conversations/{channel_id}/{bot_id}/start-fresh"` | - |
