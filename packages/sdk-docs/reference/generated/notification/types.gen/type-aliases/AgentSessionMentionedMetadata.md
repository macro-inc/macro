# Type Alias: AgentSessionMentionedMetadata

> **AgentSessionMentionedMetadata** = [`AgentSessionNotificationRef`](AgentSessionNotificationRef.md) & \{ `actionId`: `string`; `mentionedBy?`: `string` \| `null`; \}

Someone named the recipient in a prompt to an agent session.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `actionId` | `string` | The action carrying the prompt. |
| `mentionedBy?` | `string` \| `null` | Who wrote the prompt, absent when a bot acted on nobody's behalf. |
