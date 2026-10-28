# Type Alias: ColumnConfig

> **ColumnConfig** = \{ `database_id`: `string`; `kind`: `"link"`; `table_id`: `string`; \} \| \{ `formula`: [`Formula`](Formula.md); `kind`: `"derived"`; \}

Column-kind specific configuration stored on the placement.

## Union Members

### Type Literal

\{ `database_id`: `string`; `kind`: `"link"`; `table_id`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `database_id` | `string` | Target database. |
| `kind` | `"link"` | - |
| `table_id` | `string` | Target table. |

***

### Type Literal

\{ `formula`: [`Formula`](Formula.md); `kind`: `"derived"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `formula` | [`Formula`](Formula.md) | How its cells are computed. |
| `kind` | `"derived"` | - |
