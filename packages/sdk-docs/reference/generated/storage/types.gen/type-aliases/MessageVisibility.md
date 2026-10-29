# Type Alias: MessageVisibility

> **MessageVisibility** = \{ `type`: `"public"`; \} \| \{ `bot_ids`: `string`[]; `type`: `"private"`; `user_id`: `string`; \}

The immutable audience of a durable message thread.

## Union Members

### Type Literal

\{ `type`: `"public"`; \}

***

### Type Literal

\{ `bot_ids`: `string`[]; `type`: `"private"`; `user_id`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `bot_ids` | `string`[] | Canonical bot principals invited when the thread was created. |
| `type` | `"private"` | - |
| `user_id` | `string` | Authenticated user who started the thread. |
