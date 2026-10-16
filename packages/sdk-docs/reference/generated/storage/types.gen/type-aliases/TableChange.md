# Type Alias: TableChange

> **TableChange** = \{ `kind`: `"create"`; `name`: `string`; \} \| \{ `kind`: `"rename"`; `name`: `string`; `previousName?`: `string`; \} \| \{ `kind`: `"delete"`; \} \| \{ `kind`: `"reorder_columns"`; `order`: `string`[]; \} \| \{ `kind`: `"reorder_views"`; `order`: `string`[]; \}

A change to a table itself.

## Union Members

### Type Literal

\{ `kind`: `"create"`; `name`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"create"` | - |
| `name` | `string` | Its name, unique within the database ignoring case. |

***

### Type Literal

\{ `kind`: `"rename"`; `name`: `string`; `previousName?`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"rename"` | - |
| `name` | `string` | Its new name, unique within the database ignoring case. |
| `previousName?` | `string` | The name the caller saw. Given, the rename is refused if the table goes by another one now, so a concurrent rename is not overwritten. |

***

### Type Literal

\{ `kind`: `"delete"`; \}

***

### Type Literal

\{ `kind`: `"reorder_columns"`; `order`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"reorder_columns"` | - |
| `order` | `string`[] | Its columns, in their new order. |

***

### Type Literal

\{ `kind`: `"reorder_views"`; `order`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"reorder_views"` | - |
| `order` | `string`[] | Its views, in their new order. |
