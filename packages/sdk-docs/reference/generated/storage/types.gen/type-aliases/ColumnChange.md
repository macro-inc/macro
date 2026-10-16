# Type Alias: ColumnChange

> **ColumnChange** = \{ `after?`: `string`; `definition`: [`NewColumn`](NewColumn.md); `kind`: `"create"`; \} \| \{ `kind`: `"rename"`; `name`: `string`; `previousName?`: `string`; \} \| \{ `kind`: `"change_type"`; `to`: [`ColumnKind`](ColumnKind.md); \} \| \{ `kind`: `"delete"`; \} \| \{ `kind`: `"add_options"`; `options`: [`NewOption`](NewOption.md)[]; \} \| \{ `color?`: `string` \| `null`; `kind`: `"update_option"`; `label?`: `string`; `option`: `string`; \} \| \{ `formula`: [`Formula`](Formula.md); `kind`: `"set_formula"`; \} \| \{ `kind`: `"delete_option"`; `option`: `string`; \}

A change to one column.

## Union Members

### Type Literal

\{ `after?`: `string`; `definition`: [`NewColumn`](NewColumn.md); `kind`: `"create"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `after?` | `string` | The column it goes right after; left out, it goes after the table's last column. |
| `definition` | [`NewColumn`](NewColumn.md) | What the column holds. |
| `kind` | `"create"` | - |

***

### Type Literal

\{ `kind`: `"rename"`; `name`: `string`; `previousName?`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"rename"` | - |
| `name` | `string` | Its new name, unique within the table ignoring case. |
| `previousName?` | `string` | The name the caller saw. Given, the rename is refused if the column goes by another one now. |

***

### Type Literal

\{ `kind`: `"change_type"`; `to`: [`ColumnKind`](ColumnKind.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"change_type"` | - |
| `to` | [`ColumnKind`](ColumnKind.md) | The type it becomes. |

***

### Type Literal

\{ `kind`: `"delete"`; \}

***

### Type Literal

\{ `kind`: `"add_options"`; `options`: [`NewOption`](NewOption.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"add_options"` | - |
| `options` | [`NewOption`](NewOption.md)[] | The options, each under an id the client mints. |

***

### Type Literal

\{ `color?`: `string` \| `null`; `kind`: `"update_option"`; `label?`: `string`; `option`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `color?` | `string` \| `null` | Its new colour, a hex string like `#RRGGBB`, or `null` to clear it; left out, it keeps its own. A tag option always has one. |
| `kind` | `"update_option"` | - |
| `label?` | `string` | Its new label; left out, it keeps its own. Labels are unique within a column, ignoring case. |
| `option` | `string` | The option. |

***

### Type Literal

\{ `formula`: [`Formula`](Formula.md); `kind`: `"set_formula"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `formula` | [`Formula`](Formula.md) | The formula, over the table's other columns. |
| `kind` | `"set_formula"` | - |

***

### Type Literal

\{ `kind`: `"delete_option"`; `option`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"delete_option"` | - |
| `option` | `string` | The option. |
