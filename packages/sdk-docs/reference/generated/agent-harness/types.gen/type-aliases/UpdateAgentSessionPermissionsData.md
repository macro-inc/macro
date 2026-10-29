# Type Alias: UpdateAgentSessionPermissionsData

> **UpdateAgentSessionPermissionsData** = \{ `body`: [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md); `path`: \{ `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/permissions"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md) | - |
| <a id="property-path"></a> `path` | \{ `session_id`: `string`; \} | - |
| `path.session_id` | `string` | ID of the agent session |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/permissions"` | - |
