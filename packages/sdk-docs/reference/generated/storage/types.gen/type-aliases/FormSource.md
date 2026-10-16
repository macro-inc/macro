# Type Alias: FormSource

> **FormSource** = \{ `kind`: `"new"`; \} \| \{ `databaseId`: `string`; `kind`: `"table"`; `tableId`: `string`; \}

Where a new form's responses go.

## Union Members

### Type Literal

\{ `kind`: `"new"`; \}

***

### Type Literal

\{ `databaseId`: `string`; `kind`: `"table"`; `tableId`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `databaseId` | `string` | The table's database. |
| `kind` | `"table"` | - |
| `tableId` | `string` | The table. |
