# Type Alias: AnswerAgentSessionToolApprovalData

> **AnswerAgentSessionToolApprovalData** = \{ `body`: [`AnswerToolApprovalRequest`](AnswerToolApprovalRequest.md); `path`: \{ `approval_id`: `string`; `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/tool-approvals/{approval_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`AnswerToolApprovalRequest`](AnswerToolApprovalRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `approval_id`: `string`; `session_id`: `string`; \} | - |
| `path.approval_id` | `string` | ID of the held tool call |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/tool-approvals/{approval_id}"` | - |
