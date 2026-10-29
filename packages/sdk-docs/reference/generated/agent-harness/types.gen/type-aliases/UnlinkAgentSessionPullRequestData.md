# Type Alias: UnlinkAgentSessionPullRequestData

> **UnlinkAgentSessionPullRequestData** = \{ `body?`: `never`; `path`: \{ `session_id`: `string`; \}; `query`: \{ `url`: `string`; \}; `url`: `"/agent-sessions/{session_id}/pull-requests"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `session_id`: `string`; \} | - |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query` | \{ `url`: `string`; \} | - |
| `query.url` | `string` | The pull request's GitHub URL |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/pull-requests"` | - |
