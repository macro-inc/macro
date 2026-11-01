# Type Alias: SearchState

> **SearchState** = \{ `status`: `"not_needed"`; \} \| \{ `status`: `"pending"`; \} \| \{ `receiptId`: `string`; `status`: `"submitted"`; \} \| \{ `status`: `"completed"`; \} \| \{ `status`: `"failed"`; \}

Search publication/receipt state. Acceptance is not completed publication;
even completed publication still awaits consumer indexing and refresh.

## Union Members

### Type Literal

\{ `status`: `"not_needed"`; \}

***

### Type Literal

\{ `status`: `"pending"`; \}

***

### Type Literal

\{ `receiptId`: `string`; `status`: `"submitted"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `receiptId` | `string` | Receipt from the search service. |
| `status` | `"submitted"` | - |

***

### Type Literal

\{ `status`: `"completed"`; \}

***

### Type Literal

\{ `status`: `"failed"`; \}
