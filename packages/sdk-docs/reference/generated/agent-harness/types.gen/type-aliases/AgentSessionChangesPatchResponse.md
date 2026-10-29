# Type Alias: AgentSessionChangesPatchResponse

> **AgentSessionChangesPatchResponse** = \{ `patch`: `string`; \}

Response body for `GET /agent-sessions/{session_id}/changes/patch`.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-patch"></a> `patch` | `string` | The git-style unified diff of the current changeset. |
