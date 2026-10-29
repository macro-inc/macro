# Type Alias: SqlStatement

> **SqlStatement** = \{ `databaseId`: [`DatabaseId`](DatabaseId.md); `kind`: `"schema"`; `summary`: `string`; \} \| \{ `kind`: `"select"`; \} \| \{ `kind`: `"insert"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; \} \| \{ `kind`: `"update"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; \} \| \{ `kind`: `"delete"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; \} \| \{ `columnId`: [`ColumnId`](ColumnId.md); `columnName`: `string`; `kind`: `"alterColumnType"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; `to`: `string`; \}

The statement that ran: a read, or the table (and for a type change, the
column) it wrote.

## Union Members

### Type Literal

\{ `databaseId`: [`DatabaseId`](DatabaseId.md); `kind`: `"schema"`; `summary`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `databaseId` | [`DatabaseId`](DatabaseId.md) | Owning database. |
| `kind` | `"schema"` | - |
| `summary` | `string` | What changed and how to read the resulting schema. |

***

### Type Literal

\{ `kind`: `"select"`; \}

***

### Type Literal

\{ `kind`: `"insert"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"insert"` | - |
| `tableId` | [`TableId`](TableId.md) | The table written. |
| `tableName` | `string` | Its name. |

***

### Type Literal

\{ `kind`: `"update"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"update"` | - |
| `tableId` | [`TableId`](TableId.md) | The table written. |
| `tableName` | `string` | Its name. |

***

### Type Literal

\{ `kind`: `"delete"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"delete"` | - |
| `tableId` | [`TableId`](TableId.md) | The table written. |
| `tableName` | `string` | Its name. |

***

### Type Literal

\{ `columnId`: [`ColumnId`](ColumnId.md); `columnName`: `string`; `kind`: `"alterColumnType"`; `tableId`: [`TableId`](TableId.md); `tableName`: `string`; `to`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `columnId` | [`ColumnId`](ColumnId.md) | The column placement; its id survives the change. |
| `columnName` | `string` | The column's name. |
| `kind` | `"alterColumnType"` | - |
| `tableId` | [`TableId`](TableId.md) | The table. |
| `tableName` | `string` | Its name. |
| `to` | `string` | The type it became, as SQL spells it, e.g. `select[]`. |
