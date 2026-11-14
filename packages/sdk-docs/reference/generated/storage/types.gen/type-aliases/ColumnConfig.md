# Type Alias: ColumnConfig

> **ColumnConfig** = \{ `database_id`: `string`; `kind`: `"link"`; `table_id`: `string`; \} \| \{ `formula`: [`Formula`](Formula.md); `kind`: `"derived"`; `percentage?`: `boolean`; \} \| \{ `kind`: `"percentage"`; \}

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

\{ `formula`: [`Formula`](Formula.md); `kind`: `"derived"`; `percentage?`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `formula` | [`Formula`](Formula.md) | How its cells are computed. |
| `kind` | `"derived"` | - |
| `percentage?` | `boolean` | Whether a number formula is shown as a percent. |

***

### Type Literal

\{ `kind`: `"percentage"`; \}
