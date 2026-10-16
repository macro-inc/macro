# Type Alias: SetAgentSessionArchivedData

> **SetAgentSessionArchivedData** = \{ `body`: [`SetAgentSessionArchivedRequest`](SetAgentSessionArchivedRequest.md); `path`: \{ `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/archived"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetAgentSessionArchivedRequest`](SetAgentSessionArchivedRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `session_id`: `string`; \} | - |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/archived"` | - |
