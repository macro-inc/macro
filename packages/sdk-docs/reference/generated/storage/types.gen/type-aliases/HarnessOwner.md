# Type Alias: HarnessOwner

> **HarnessOwner** = \{ `type`: `"user"`; `user_id`: `string`; \} \| \{ `team_id`: `string`; `type`: `"team"`; \}

Harness owner.

Exactly one of a user or a team, mirroring the bots owner pattern. There
are no system harnesses.

## Union Members

### Type Literal

\{ `type`: `"user"`; `user_id`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"user"` | - |
| `user_id` | `string` | Owner user id. |

***

### Type Literal

\{ `team_id`: `string`; `type`: `"team"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `team_id` | `string` | Owner team id. |
| `type` | `"team"` | - |
