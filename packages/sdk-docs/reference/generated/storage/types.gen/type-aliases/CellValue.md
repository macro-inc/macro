# Type Alias: CellValue

> **CellValue** = \{ `type`: `"text"`; `value`: `string`; \} \| \{ `type`: `"number"`; `value`: `number`; \} \| \{ `type`: `"boolean"`; `value`: `boolean`; \} \| \{ `type`: `"date"`; `value`: `string`; \} \| \{ `type`: `"link"`; `value`: `string`[]; \} \| \{ `type`: `"options"`; `value`: [`OptionRef`](OptionRef.md)[]; \} \| \{ `type`: `"entities"`; `value`: [`EntityRef`](EntityRef.md)[]; \} \| \{ `type`: `"rows"`; `value`: `string`[]; \} \| \{ `type`: `"clear"`; \}

A cell's value. It must fit the column's type: text for a text column,
options of the column for a select, and so on.

## Union Members

### Type Literal

\{ `type`: `"text"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"text"` | - |
| `value` | `string` | Free text. |

***

### Type Literal

\{ `type`: `"number"`; `value`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"number"` | - |
| `value` | `number` | A finite number. |

***

### Type Literal

\{ `type`: `"boolean"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"boolean"` | - |
| `value` | `boolean` | A checkbox. |

***

### Type Literal

\{ `type`: `"date"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"date"` | - |
| `value` | `string` | A date-time. |

***

### Type Literal

\{ `type`: `"link"`; `value`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"link"` | - |
| `value` | `string`[] | Complete http or https URLs; at most one for a single-valued column. |

***

### Type Literal

\{ `type`: `"options"`; `value`: [`OptionRef`](OptionRef.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"options"` | - |
| `value` | [`OptionRef`](OptionRef.md)[] | Options of a select or tag column; at most one for a single-valued column. |

***

### Type Literal

\{ `type`: `"entities"`; `value`: [`EntityRef`](EntityRef.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"entities"` | - |
| `value` | [`EntityRef`](EntityRef.md)[] | References to Macro entities of the kind the column points at; at most one for a single-valued column. |

***

### Type Literal

\{ `type`: `"rows"`; `value`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"rows"` | - |
| `value` | `string`[] | Rows of the table a relation column points at. |

***

### Type Literal

\{ `type`: `"clear"`; \}
