# Type Alias: MailboxAction

> **MailboxAction** = \{ `kind`: `"read"`; `value`: `boolean`; \} \| \{ `kind`: `"flagged"`; `value`: `boolean`; \} \| \{ `kind`: `"archived"`; `value`: `boolean`; \} \| \{ `kind`: `"trashed"`; `value`: `boolean`; \} \| \{ `kind`: `"junk"`; `value`: `boolean`; \} \| \{ `kind`: `"category"`; `value`: \{ `name`: `string`; `present`: `boolean`; \}; \}

Desired organization state. Categories never stand in for folders or flags.

## Union Members

### Type Literal

\{ `kind`: `"read"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"read"` | - |
| `value` | `boolean` | Mark correspondence read or unread. |

***

### Type Literal

\{ `kind`: `"flagged"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"flagged"` | - |
| `value` | `boolean` | Set the follow-up star. |

***

### Type Literal

\{ `kind`: `"archived"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"archived"` | - |
| `value` | `boolean` | Archive inbox messages, or restore received correspondence to the inbox. |

***

### Type Literal

\{ `kind`: `"trashed"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"trashed"` | - |
| `value` | `boolean` | Move to recoverable trash, or restore correspondence to Inbox (drafts to Drafts). |

***

### Type Literal

\{ `kind`: `"junk"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"junk"` | - |
| `value` | `boolean` | Move to junk, or restore to the inbox. |

***

### Type Literal

\{ `kind`: `"category"`; `value`: \{ `name`: `string`; `present`: `boolean`; \}; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"category"` | - |
| `value` | \{ `name`: `string`; `present`: `boolean`; \} | Add/remove a category while preserving other provider assignments. |
| `value.name` | `string` | - |
| `value.present` | `boolean` | - |
