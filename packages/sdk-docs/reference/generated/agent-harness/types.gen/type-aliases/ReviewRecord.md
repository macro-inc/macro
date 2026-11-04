# Type Alias: ReviewRecord

> **ReviewRecord** = \{\[`key`: `string`\]: `unknown`; \} & \{ `actingUser`: `string`; `decision?`: `null` \| [`ReviewDecisionContext`](ReviewDecisionContext.md); `executionId?`: `null` \| [`ExecutionId`](ExecutionId.md); `id`: [`ReviewId`](ReviewId.md); `presentedAt?`: `number` \| `null`; `revision`: `number`; `sessionId`: `string`; `title`: `string`; `updatedAt`: `number`; \}

Full UI record, fetched outside the model context.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `actingUser` | `string` | Account whose email/calendar the drafts use. |
| `decision?` | `null` \| [`ReviewDecisionContext`](ReviewDecisionContext.md) | - |
| `executionId?` | `null` \| [`ExecutionId`](ExecutionId.md) | - |
| `id` | [`ReviewId`](ReviewId.md) | Review identity. |
| `presentedAt?` | `number` \| `null` | Durable presentation acknowledgment, separate from user decisions. |
| `revision` | `number` | Compare-and-swap revision for edits and submissions. |
| `sessionId` | `string` | Owning session. |
| `title` | `string` | Stack label. |
| `updatedAt` | `number` | Milliseconds since epoch of the last state change. |
