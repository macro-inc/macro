# Type Alias: RenameAgentSessionData

> **RenameAgentSessionData** = \{ `body`: [`RenameAgentSessionRequest`](RenameAgentSessionRequest.md); `path`: \{ `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/name"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`RenameAgentSessionRequest`](RenameAgentSessionRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `session_id`: `string`; \} | - |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/name"` | - |
