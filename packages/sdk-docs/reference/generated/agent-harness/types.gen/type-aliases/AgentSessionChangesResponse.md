# Type Alias: AgentSessionChangesResponse

> **AgentSessionChangesResponse** = \{ `attempt?`: `null` \| [`CaptureAttemptDto`](CaptureAttemptDto.md); `capturing`: `boolean`; `changeset?`: `null` \| [`ChangesetDto`](ChangesetDto.md); \}

Response body for `GET /agent-sessions/{session_id}/changes`.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attempt"></a> `attempt?` | `null` \| [`CaptureAttemptDto`](CaptureAttemptDto.md) | - |
| <a id="property-capturing"></a> `capturing` | `boolean` | A capture is running right now. |
| <a id="property-changeset"></a> `changeset?` | `null` \| [`ChangesetDto`](ChangesetDto.md) | - |
