# Type Alias: OpResult

> **OpResult** = \{ `change`: [`TableResult`](TableResult.md); `kind`: `"table"`; `table`: `string`; `tableVersion?`: [`TableVersion`](TableVersion.md); \} \| \{ `change`: [`ColumnResult`](ColumnResult.md); `column`: `string`; `kind`: `"column"`; `table`: `string`; `tableVersion`: [`TableVersion`](TableVersion.md); \} \| \{ `change`: [`RowsResult`](RowsResult.md); `kind`: `"rows"`; `table`: `string`; `tableVersion`: [`TableVersion`](TableVersion.md); \} \| \{ `change`: [`ViewResult`](ViewResult.md); `kind`: `"view"`; `table`: `string`; `tableVersion`: [`TableVersion`](TableVersion.md); `view`: `string`; \} \| \{ `kind`: `"reorder_tables"`; `tables`: [`VersionedTable`](VersionedTable.md)[]; \}

What one op did, in the order the ops were sent, grouped as the ops are:
a result's `kind` is its op's, naming the same resource, and its
`change` says what happened to it.

## Union Members

### Type Literal

\{ `change`: [`TableResult`](TableResult.md); `kind`: `"table"`; `table`: `string`; `tableVersion?`: [`TableVersion`](TableVersion.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`TableResult`](TableResult.md) | What happened to it. |
| `kind` | `"table"` | - |
| `table` | `string` | The table. |
| `tableVersion?` | [`TableVersion`](TableVersion.md) | Its version once the request committed; left out when the op removed it. |

***

### Type Literal

\{ `change`: [`ColumnResult`](ColumnResult.md); `column`: `string`; `kind`: `"column"`; `table`: `string`; `tableVersion`: [`TableVersion`](TableVersion.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`ColumnResult`](ColumnResult.md) | What happened to it. |
| `column` | `string` | The column. |
| `kind` | `"column"` | - |
| `table` | `string` | The table. |
| `tableVersion` | [`TableVersion`](TableVersion.md) | The table's version once the request committed. |

***

### Type Literal

\{ `change`: [`RowsResult`](RowsResult.md); `kind`: `"rows"`; `table`: `string`; `tableVersion`: [`TableVersion`](TableVersion.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`RowsResult`](RowsResult.md) | What happened to them. |
| `kind` | `"rows"` | - |
| `table` | `string` | The table. |
| `tableVersion` | [`TableVersion`](TableVersion.md) | The table's version once the request committed. |

***

### Type Literal

\{ `change`: [`ViewResult`](ViewResult.md); `kind`: `"view"`; `table`: `string`; `tableVersion`: [`TableVersion`](TableVersion.md); `view`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `change` | [`ViewResult`](ViewResult.md) | What happened to it. |
| `kind` | `"view"` | - |
| `table` | `string` | The view's table. |
| `tableVersion` | [`TableVersion`](TableVersion.md) | The table's version once the request committed. |
| `view` | `string` | The view. |

***

### Type Literal

\{ `kind`: `"reorder_tables"`; `tables`: [`VersionedTable`](VersionedTable.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"reorder_tables"` | - |
| `tables` | [`VersionedTable`](VersionedTable.md)[] | Every table, in its new order, with its version once the request committed. |
