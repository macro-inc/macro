# Type Alias: CreateAgentSessionResponse

> **CreateAgentSessionResponse** = \{ `session`: [`AgentSessionResponse`](AgentSessionResponse.md); \}

Response body for `POST /agent-sessions`.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-session"></a> `session` | [`AgentSessionResponse`](AgentSessionResponse.md) | The created session. |
