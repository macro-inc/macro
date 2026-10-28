# Type Alias: TableResult

> **TableResult** = \{ `kind`: `"created"`; \} \| \{ `kind`: `"renamed"`; \} \| \{ `kind`: `"deleted"`; \} \| \{ `kind`: `"columns_reordered"`; \} \| \{ `kind`: `"views_reordered"`; `positions`: [`ViewPosition`](ViewPosition.md)[]; \}

What happened to a table.

## Union Members

### Type Literal

\{ `kind`: `"created"`; \}

***

### Type Literal

\{ `kind`: `"renamed"`; \}

***

### Type Literal

\{ `kind`: `"deleted"`; \}

***

### Type Literal

\{ `kind`: `"columns_reordered"`; \}

***

### Type Literal

\{ `kind`: `"views_reordered"`; `positions`: [`ViewPosition`](ViewPosition.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"views_reordered"` | - |
| `positions` | [`ViewPosition`](ViewPosition.md)[] | Every view's key, in their new order. |
