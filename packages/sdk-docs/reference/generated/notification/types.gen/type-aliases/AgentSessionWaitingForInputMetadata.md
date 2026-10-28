# Type Alias: AgentSessionWaitingForInputMetadata

> **AgentSessionWaitingForInputMetadata** = [`AgentSessionNotificationRef`](AgentSessionNotificationRef.md) & \{ `question`: `string`; `turn`: `number`; \}

An agent is blocked on a question only the session's owner can answer.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `question` | `string` | The question, as the agent phrased it. |
| `turn` | `number` | The turn asking. |
