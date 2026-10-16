# Type Alias: RetryAgentConversationTurnData

> **RetryAgentConversationTurnData** = \{ `body`: [`RetryAgentConversationTurnRequest`](RetryAgentConversationTurnRequest.md); `path`: \{ `bot_id`: `string`; `channel_id`: `string`; `source`: `string`; \}; `query?`: `never`; `url`: `"/agent-conversations/{channel_id}/{bot_id}/turns/{source}/retry"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`RetryAgentConversationTurnRequest`](RetryAgentConversationTurnRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `bot_id`: `string`; `channel_id`: `string`; `source`: `string`; \} | - |
| `path.bot_id` | `string` | Persona the conversation is with |
| `path.channel_id` | `string` | - |
| `path.source` | `string` | - |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-conversations/{channel_id}/{bot_id}/turns/{source}/retry"` | - |
