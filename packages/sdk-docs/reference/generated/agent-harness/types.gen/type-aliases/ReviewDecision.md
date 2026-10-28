# Type Alias: ReviewDecision

> **ReviewDecision** = \{ `action`: `"edit"`; `draft`: `unknown`; `item`: `string`; `revision`: `number`; \} \| \{ `action`: `"submit"`; `items`: `string`[]; `revision`: `number`; \} \| \{ `action`: `"dismiss"`; `items`: `string`[]; `revision`: `number`; \}

One atomic user decision against the displayed revision.

## Union Members

### Type Literal

\{ `action`: `"edit"`; `draft`: `unknown`; `item`: `string`; `revision`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `action` | `"edit"` | - |
| `draft` | `unknown` | Replacement action arguments. |
| `item` | `string` | Pending item to update. |
| `revision` | `number` | Revision displayed by the caller. |

***

### Type Literal

\{ `action`: `"submit"`; `items`: `string`[]; `revision`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `action` | `"submit"` | - |
| `items` | `string`[] | Pending items, or an empty list to select all pending items. |
| `revision` | `number` | Revision displayed by the caller. |

***

### Type Literal

\{ `action`: `"dismiss"`; `items`: `string`[]; `revision`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `action` | `"dismiss"` | - |
| `items` | `string`[] | Pending items, or an empty list to select all pending items. |
| `revision` | `number` | Revision displayed by the caller. |
