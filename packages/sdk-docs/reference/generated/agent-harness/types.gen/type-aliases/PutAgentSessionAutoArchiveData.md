# Type Alias: PutAgentSessionAutoArchiveData

> **PutAgentSessionAutoArchiveData** = \{ `body`: [`AutoArchiveOverridesBody`](AutoArchiveOverridesBody.md); `path`: \{ `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/auto-archive"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`AutoArchiveOverridesBody`](AutoArchiveOverridesBody.md) | - |
| <a id="property-path"></a> `path` | \{ `session_id`: `string`; \} | - |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/auto-archive"` | - |
