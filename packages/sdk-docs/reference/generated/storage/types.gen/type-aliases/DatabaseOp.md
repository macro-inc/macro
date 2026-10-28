# Type Alias: DatabaseOp

> **DatabaseOp** = \{ `change`: [`TableChange`](TableChange.md); `kind`: `"table"`; `table`: `string`; \} \| \{ `change`: [`ColumnChange`](ColumnChange.md); `column`: `string`; `kind`: `"column"`; `table`: `string`; \} \| \{ `change`: [`RowsChange`](RowsChange.md); `kind`: `"rows"`; `table`: `string`; \} \| \{ `change`: [`ViewChange`](ViewChange.md); `kind`: `"view"`; `table`: `string`; `view`: `string`; \} \| \{ `kind`: `"reorder_tables"`; `order`: `string`[]; \}

One write to a database: its tables, columns, options, rows or views,
grouped by the resource it changes. A request's ops apply in order and
together, or not at all, and every op names a table of the database the
request is for (or, creating one, adds it there).

## Union Members

### Type Literal

\{ `change`: [`TableChange`](TableChange.md); `kind`: `"table"`; `table`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`TableChange`](TableChange.md) | What changes. |
| `kind` | `"table"` | - |
| `table` | `string` | The table; for a creation, its new id, minted by the client, which later ops of the request may name. |

***

### Type Literal

\{ `change`: [`ColumnChange`](ColumnChange.md); `column`: `string`; `kind`: `"column"`; `table`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`ColumnChange`](ColumnChange.md) | What changes. |
| `column` | `string` | The column; for a creation, its new id, minted by the client, which later ops of the request may name. |
| `kind` | `"column"` | - |
| `table` | `string` | The table. |

***

### Type Literal

\{ `change`: [`RowsChange`](RowsChange.md); `kind`: `"rows"`; `table`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`RowsChange`](RowsChange.md) | What changes. |
| `kind` | `"rows"` | - |
| `table` | `string` | The table the rows belong to. |

***

### Type Literal

\{ `change`: [`ViewChange`](ViewChange.md); `kind`: `"view"`; `table`: `string`; `view`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`ViewChange`](ViewChange.md) | What changes. |
| `kind` | `"view"` | - |
| `table` | `string` | The view's table. |
| `view` | `string` | The view; for a creation, its new id, minted by the client. |

***

### Type Literal

\{ `kind`: `"reorder_tables"`; `order`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"reorder_tables"` | - |
| `order` | `string`[] | Every table, in its new order. |
