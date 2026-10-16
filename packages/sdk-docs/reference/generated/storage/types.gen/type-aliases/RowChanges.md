# Type Alias: RowChanges

> **RowChanges** = \{ `cells`: [`CellWrite`](CellWrite.md)[]; `kind`: `"uniform"`; `rows`: `string`[]; \} \| \{ `kind`: `"per_row"`; `rows`: [`RowChange`](RowChange.md)[]; \}

Which rows an update writes, and with what.

## Union Members

### Type Literal

\{ `cells`: [`CellWrite`](CellWrite.md)[]; `kind`: `"uniform"`; `rows`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `cells` | [`CellWrite`](CellWrite.md)[] | The cells each of them gets. |
| `kind` | `"uniform"` | - |
| `rows` | `string`[] | The rows. |

***

### Type Literal

\{ `kind`: `"per_row"`; `rows`: [`RowChange`](RowChange.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"per_row"` | - |
| `rows` | [`RowChange`](RowChange.md)[] | The rows and their cells, in order. |
