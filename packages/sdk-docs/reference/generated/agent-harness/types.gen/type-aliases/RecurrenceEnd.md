# Type Alias: RecurrenceEnd

> **RecurrenceEnd** = \{ `kind`: `"never"`; \} \| \{ `count`: `number`; `kind`: `"after"`; \} \| \{ `date`: `string`; `kind`: `"on"`; \}

Resolved recurrence ending condition accepted by the shared calendar editor.

## Union Members

### Type Literal

\{ `kind`: `"never"`; \}

***

### Type Literal

\{ `count`: `number`; `kind`: `"after"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `count` | `number` | Positive occurrence count. |
| `kind` | `"after"` | - |

***

### Type Literal

\{ `date`: `string`; `kind`: `"on"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `date` | `string` | Date resolved against the request's clock and timezone. |
| `kind` | `"on"` | - |
