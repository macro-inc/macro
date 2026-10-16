# Type Alias: RowsResult

> **RowsResult** = \{ `kind`: `"inserted"`; `rows`: `string`[]; \} \| \{ `affected`: `number`; `kind`: `"updated"`; \} \| \{ `affected`: `number`; `kind`: `"deleted"`; \}

What happened to a table's rows.

## Union Members

### Type Literal

\{ `kind`: `"inserted"`; `rows`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"inserted"` | - |
| `rows` | `string`[] | The new rows, in the order they were sent. |

***

### Type Literal

\{ `affected`: `number`; `kind`: `"updated"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `affected` | `number` | How many rows the op updated. |
| `kind` | `"updated"` | - |

***

### Type Literal

\{ `affected`: `number`; `kind`: `"deleted"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `affected` | `number` | How many rows the op deleted. |
| `kind` | `"deleted"` | - |
