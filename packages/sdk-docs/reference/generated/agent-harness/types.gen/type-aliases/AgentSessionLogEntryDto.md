# Type Alias: AgentSessionLogEntryDto

> **AgentSessionLogEntryDto** = [`LogFrameDto`](LogFrameDto.md) & \{ `createdAt`: `string`; `id`: `string`; `userId?`: `string` \| `null`; \}

One entry of a session's protocol log.

Serializes as `{"userId": ..., "direction": ..., "content": ...}` - the
frame's own two fields, flattened in beside the attribution, which is the
same shape a recorded session's JSONL carries. A reader can deserialize the
`direction`/`content` pair straight back into the fold's own log type
rather than through a transport vocabulary of its own.

`agentSessionId` is not repeated per entry: every entry in a response
belongs to the session named once at the top.

`Deserialize` is for the wire-contract tests only - nothing server-side
decodes its own response type.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | When the log recorded the frame. The frame itself carries no time, so this comes from the log row. It is what a reader has to order these against anything else it is showing beside them - the fold derives an order among the messages of one session and nothing more. |
| `id` | `string` | Durable transport row identity; together with `createdAt`, its order cursor. |
| `userId?` | `string` \| `null` | The user whose action produced the frame, absent when no user did. Only prompts carry one, and only when the frame was attributed at the time - a replayed or recorded session's are anonymous. |
