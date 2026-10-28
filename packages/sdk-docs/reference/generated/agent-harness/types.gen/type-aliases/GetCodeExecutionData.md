# Type Alias: GetCodeExecutionData

> **GetCodeExecutionData** = \{ `body?`: `never`; `path`: \{ `execution_id`: `string`; `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/code-executions/{execution_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `execution_id`: `string`; `session_id`: `string`; \} | - |
| `path.execution_id` | `string` | Execution receipt identity |
| `path.session_id` | `string` | Owning session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/code-executions/{execution_id}"` | - |
