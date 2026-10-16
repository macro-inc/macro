# Type Alias: RowsChange

> **RowsChange** = \{ `kind`: `"insert"`; `rows`: [`CellWrite`](CellWrite.md)[][]; \} \| \{ `changes`: [`RowChanges`](RowChanges.md); `kind`: `"update"`; \} \| \{ `kind`: `"delete"`; `rows`: `string`[]; \}

A write to a table's rows.

## Union Members

### Type Literal

\{ `kind`: `"insert"`; `rows`: [`CellWrite`](CellWrite.md)[][]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"insert"` | - |
| `rows` | [`CellWrite`](CellWrite.md)[][] | One entry per new row: the cells it starts with. Columns left out start empty. |

***

### Type Literal

\{ `changes`: [`RowChanges`](RowChanges.md); `kind`: `"update"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `changes` | [`RowChanges`](RowChanges.md) | Which rows get which cells. |
| `kind` | `"update"` | - |

***

### Type Literal

\{ `kind`: `"delete"`; `rows`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"delete"` | - |
| `rows` | `string`[] | The rows, each named once. |
