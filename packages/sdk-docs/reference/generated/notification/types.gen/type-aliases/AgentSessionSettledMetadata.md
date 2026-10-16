# Type Alias: AgentSessionSettledMetadata

> **AgentSessionSettledMetadata** = [`AgentSessionNotificationRef`](AgentSessionNotificationRef.md) & \{ `actor?`: `string` \| `null`; `excerpt?`: `string` \| `null`; `stopReason`: `string`; `turn`: `number`; \}

An agent finished a turn with nothing queued behind it.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `actor?` | `string` \| `null` | Who prompted the turn, absent when a bot acted on nobody's behalf. |
| `excerpt?` | `string` \| `null` | The agent's last prose in the turn, whole; `None` when it wrote none. |
| `stopReason` | `string` | The ACP stop reason, or `error`. |
| `turn` | `number` | The turn that ended. |
