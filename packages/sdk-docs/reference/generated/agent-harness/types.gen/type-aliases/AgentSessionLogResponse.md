# Type Alias: AgentSessionLogResponse

> **AgentSessionLogResponse** = \{ `bot`: [`SessionBot`](SessionBot.md); `entries`: [`AgentSessionLogEntryDto`](AgentSessionLogEntryDto.md)[]; \}

Response body for one session's raw protocol log.

A wrapper rather than a bare array so that anything which is about the
response rather than about a frame has somewhere to go later without
breaking every client.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot"></a> `bot` | [`SessionBot`](SessionBot.md) | The agent whose messages the log derives. Here because a client renders those messages and cannot otherwise work out who sent them: the sender of an agent message is this session's bot, and nothing else names it. |
| <a id="property-entries"></a> `entries` | [`AgentSessionLogEntryDto`](AgentSessionLogEntryDto.md)[] | Effective history in ascending `(createdAt, id)` order. The first row is the inclusive history boundary cursor: buffered rows before it are obsolete. Reconcile snapshot overlap by row ID, never content. An empty history has no boundary or overlapping rows. |
