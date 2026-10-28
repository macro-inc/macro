# Type Alias: RemoveQueuedActionData

> **RemoveQueuedActionData** = \{ `body?`: `never`; `path`: \{ `action_id`: `string`; `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/queue/{action_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `action_id`: `string`; `session_id`: `string`; \} | - |
| `path.action_id` | `string` | ID the action was accepted under |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/queue/{action_id}"` | - |
