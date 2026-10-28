# Type Alias: EmailFollowupCommand

> **EmailFollowupCommand** = \{ `condition`: [`EmailReminderCondition`](EmailReminderCondition.md); `expectedRevision?`: `string` \| `null`; `operationId`: `string`; `remindAt`: `string`; `type`: `"set"`; \} \| \{ `expectedRevision`: `string`; `operationId`: `string`; `type`: `"remove"`; `undo?`: `boolean`; \}

Idempotent email command. Reusing an operation ID with different data fails.

## Union Members

### Type Literal

\{ `condition`: [`EmailReminderCondition`](EmailReminderCondition.md); `expectedRevision?`: `string` \| `null`; `operationId`: `string`; `remindAt`: `string`; `type`: `"set"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `condition` | [`EmailReminderCondition`](EmailReminderCondition.md) | Reply condition. |
| `expectedRevision?` | `string` \| `null` | None for creation, the current revision for edits. |
| `operationId` | `string` | Unique request identity retained across network retries. |
| `remindAt` | `string` | One future instant; conditional recurrence is deliberately absent. |
| `type` | `"set"` | - |

***

### Type Literal

\{ `expectedRevision`: `string`; `operationId`: `string`; `type`: `"remove"`; `undo?`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `expectedRevision` | `string` | Reject removal if a newer edit has replaced this operation. |
| `operationId` | `string` | Unique request identity. |
| `type` | `"remove"` | - |
| `undo?` | `boolean` | Undo restores original visibility; ordinary Remove returns to inbox. |
