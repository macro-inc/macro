# Type Alias: ColumnResult

> **ColumnResult** = \{ `kind`: `"created"`; \} \| \{ `kind`: `"renamed"`; \} \| \{ `kind`: `"type_changed"`; \} \| \{ `kind`: `"deleted"`; \} \| \{ `added`: `string`[]; `kind`: `"options_added"`; \} \| \{ `kind`: `"option_updated"`; \} \| \{ `kind`: `"option_deleted"`; \} \| \{ `kind`: `"formula_set"`; \}

What happened to a column.

## Union Members

### Type Literal

\{ `kind`: `"created"`; \}

***

### Type Literal

\{ `kind`: `"renamed"`; \}

***

### Type Literal

\{ `kind`: `"type_changed"`; \}

***

### Type Literal

\{ `kind`: `"deleted"`; \}

***

### Type Literal

\{ `added`: `string`[]; `kind`: `"options_added"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `added` | `string`[] | The options created, in order: those sent, less any whose label the column already had. |
| `kind` | `"options_added"` | - |

***

### Type Literal

\{ `kind`: `"option_updated"`; \}

***

### Type Literal

\{ `kind`: `"option_deleted"`; \}

***

### Type Literal

\{ `kind`: `"formula_set"`; \}
