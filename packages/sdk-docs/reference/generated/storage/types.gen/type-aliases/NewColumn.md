# Type Alias: NewColumn

> **NewColumn** = \{ `inferType?`: `boolean`; `name`: `string`; `options?`: [`NewOption`](NewOption.md)[]; `source`: `"new"`; `type`: [`ColumnKind`](ColumnKind.md); \} \| \{ `formula`: [`Formula`](Formula.md); `name`: `string`; `source`: `"derived"`; \} \| \{ `property`: `string`; `source`: `"existing"`; \}

What a new column holds.

## Union Members

### Type Literal

\{ `inferType?`: `boolean`; `name`: `string`; `options?`: [`NewOption`](NewOption.md)[]; `source`: `"new"`; `type`: [`ColumnKind`](ColumnKind.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `inferType?` | `boolean` | Let the column's first value settle its type: only for a plain text column. |
| `name` | `string` | The column's name, unique within the table ignoring case. |
| `options?` | [`NewOption`](NewOption.md)[] | For a select or tag column, the options it starts with, in order, each under an id the client mints. A select column with none accepts nothing until options are added. |
| `source` | `"new"` | - |
| `type` | [`ColumnKind`](ColumnKind.md) | Its type. A relation names the table whose rows it holds, one the caller can see. |

***

### Type Literal

\{ `formula`: [`Formula`](Formula.md); `name`: `string`; `source`: `"derived"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `formula` | [`Formula`](Formula.md) | How its cells are computed: arithmetic over the table's number, date and other derived columns. |
| `name` | `string` | The column's name, unique within the table ignoring case. |
| `source` | `"derived"` | - |

***

### Type Literal

\{ `property`: `string`; `source`: `"existing"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The property's definition. |
| `source` | `"existing"` | - |
