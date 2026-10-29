# Type Alias: LaneKey

> **LaneKey** = \{ `id`: `string`; `kind`: `"option"`; \} \| \{ `id`: `string`; `kind`: `"user"`; \} \| \{ `kind`: `"none"`; \}

A lane of a board, named by what its cards' grouping cells hold: one
option of a select, one person, or nothing.

## Union Members

### Type Literal

\{ `id`: `string`; `kind`: `"option"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | The cards holding this option of the board's select column. |
| `kind` | `"option"` | - |

***

### Type Literal

\{ `id`: `string`; `kind`: `"user"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | The cards naming this person in the board's person column. |
| `kind` | `"user"` | - |

***

### Type Literal

\{ `kind`: `"none"`; \}
