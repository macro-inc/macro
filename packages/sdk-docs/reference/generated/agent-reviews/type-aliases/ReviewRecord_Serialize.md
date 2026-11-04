# Type Alias: ReviewRecord\_Serialize

> **ReviewRecord\_Serialize** = \{ `actingUser`: `string`; `decision`: [`ReviewDecisionContext`](ReviewDecisionContext.md) \| `null`; `executionId`: [`ExecutionId`](ExecutionId.md) \| `null`; `id`: [`ReviewId`](ReviewId.md); `presentedAt`: `number` \| `null`; `revision`: `number`; `sessionId`: `string`; `title`: [`ReviewTitle`](ReviewTitle.md); `updatedAt`: `number`; \} & [`ReviewItems_Serialize`](ReviewItems_Serialize.md)

Full UI record, fetched outside the model context.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `actingUser` | `string` | Account whose email/calendar the drafts use. |
| `decision` | [`ReviewDecisionContext`](ReviewDecisionContext.md) \| `null` | Current batch's authenticated decision, preserved for interrupted work. |
| `executionId` | [`ExecutionId`](ExecutionId.md) \| `null` | Originating code execution, absent for directly presented reviews. |
| `id` | [`ReviewId`](ReviewId.md) | Review identity. |
| `presentedAt` | `number` \| `null` | Durable presentation acknowledgment, separate from user decisions. |
| `revision` | `number` | Compare-and-swap revision for edits and submissions. |
| `sessionId` | `string` | Owning session. |
| `title` | [`ReviewTitle`](ReviewTitle.md) | Stack label. |
| `updatedAt` | `number` | Milliseconds since epoch of the last state change. |
