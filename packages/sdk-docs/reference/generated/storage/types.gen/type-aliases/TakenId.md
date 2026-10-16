# Type Alias: TakenId

> **TakenId** = \{ `id`: `string`; `kind`: `"table"`; \} \| \{ `id`: `string`; `kind`: `"column"`; \} \| \{ `id`: `string`; `kind`: `"option"`; \} \| \{ `id`: `string`; `kind`: `"view"`; \}

An id a request minted for something new that already names something,
which refuses the request: a retried request whose first attempt
committed, or an id minted twice.

## Union Members

### Type Literal

\{ `id`: `string`; `kind`: `"table"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A table's. |
| `kind` | `"table"` | - |

***

### Type Literal

\{ `id`: `string`; `kind`: `"column"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A column's. |
| `kind` | `"column"` | - |

***

### Type Literal

\{ `id`: `string`; `kind`: `"option"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | An option's. |
| `kind` | `"option"` | - |

***

### Type Literal

\{ `id`: `string`; `kind`: `"view"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A view's. |
| `kind` | `"view"` | - |
