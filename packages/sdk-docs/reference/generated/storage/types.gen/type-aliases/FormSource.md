# Type Alias: FormSource

> **FormSource** = \{ `isHiddenInDrive?`: `boolean`; `kind`: `"new"`; \} \| \{ `databaseId`: `string`; `kind`: `"table"`; `tableId`: `string`; \}

Where a new form's responses go.

## Union Members

### Type Literal

\{ `isHiddenInDrive?`: `boolean`; `kind`: `"new"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `isHiddenInDrive?` | `boolean` | Keep the form, and the database made for it, out of Drive, as for a channel poll. |
| `kind` | `"new"` | - |

***

### Type Literal

\{ `databaseId`: `string`; `kind`: `"table"`; `tableId`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `databaseId` | `string` | The table's database. |
| `kind` | `"table"` | - |
| `tableId` | `string` | The table. |
