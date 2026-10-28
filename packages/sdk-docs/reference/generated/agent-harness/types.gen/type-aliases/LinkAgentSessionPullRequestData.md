# Type Alias: LinkAgentSessionPullRequestData

> **LinkAgentSessionPullRequestData** = \{ `body`: [`PullRequestUrl`](PullRequestUrl.md); `path`: \{ `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/pull-requests"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`PullRequestUrl`](PullRequestUrl.md) | - |
| <a id="property-path"></a> `path` | \{ `session_id`: `string`; \} | - |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/pull-requests"` | - |
