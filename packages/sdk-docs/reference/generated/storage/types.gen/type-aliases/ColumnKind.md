# Type Alias: ColumnKind

> **ColumnKind** = \{ `type`: `"text"`; \} \| \{ `type`: `"number"`; \} \| \{ `type`: `"boolean"`; \} \| \{ `type`: `"date"`; \} \| \{ `type`: `"link"`; \} \| \{ `multi`: `boolean`; `type`: `"select"`; \} \| \{ `multi`: `boolean`; `type`: `"select_number"`; \} \| \{ `type`: `"tag"`; \} \| \{ `multi`: `boolean`; `target`: [`EntityKind`](EntityKind.md); `type`: `"entity"`; \} \| \{ `database`: `string`; `table`: `string`; `type`: `"relation"`; \}

A type a column can have.

## Union Members

### Type Literal

\{ `type`: `"text"`; \}

***

### Type Literal

\{ `type`: `"number"`; \}

***

### Type Literal

\{ `type`: `"boolean"`; \}

***

### Type Literal

\{ `type`: `"date"`; \}

***

### Type Literal

\{ `type`: `"link"`; \}

***

### Type Literal

\{ `multi`: `boolean`; `type`: `"select"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `multi` | `boolean` | Whether a cell holds several options. |
| `type` | `"select"` | - |

***

### Type Literal

\{ `multi`: `boolean`; `type`: `"select_number"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `multi` | `boolean` | Whether a cell holds several options. |
| `type` | `"select_number"` | - |

***

### Type Literal

\{ `type`: `"tag"`; \}

***

### Type Literal

\{ `multi`: `boolean`; `target`: [`EntityKind`](EntityKind.md); `type`: `"entity"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `multi` | `boolean` | Whether a cell holds several references. |
| `target` | [`EntityKind`](EntityKind.md) | What the references point at. |
| `type` | `"entity"` | - |

***

### Type Literal

\{ `database`: `string`; `table`: `string`; `type`: `"relation"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `database` | `string` | The database of the related table. |
| `table` | `string` | The related table. |
| `type` | `"relation"` | - |
