# Type Alias: PreviewAgentSessionsResponse

> **PreviewAgentSessionsResponse** = \{ `previews`: [`AgentSessionPreviewDto`](AgentSessionPreviewDto.md)[]; \}

Response body for `POST /agent-sessions/preview`: one entry per distinct
requested id, in no particular order.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-previews"></a> `previews` | [`AgentSessionPreviewDto`](AgentSessionPreviewDto.md)[] | What the caller may see of each requested session. |
