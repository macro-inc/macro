# Type Alias: SqlCell

> **SqlCell** = \{ `type`: `"text"`; `value`: `string`; \} \| \{ `type`: `"number"`; `value`: `number`; \} \| \{ `type`: `"bool"`; `value`: `boolean`; \} \| \{ `type`: `"date"`; `value`: `string`; \} \| \{ `type`: `"options"`; `value`: [`OptionId`](OptionId.md)[]; \} \| \{ `type`: `"entities"`; `value`: `string`[]; \} \| \{ `type`: `"row"`; `value`: [`RowId`](RowId.md); \}

A cell as fetched. An absent cell is `NULL`; an absent multi-valued cell
is the empty set.

## Union Members

### Type Literal

\{ `type`: `"text"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"text"` | - |
| `value` | `string` | Text or link. |

***

### Type Literal

\{ `type`: `"number"`; `value`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"number"` | - |
| `value` | `number` | A number. |

***

### Type Literal

\{ `type`: `"bool"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"bool"` | - |
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

\{ `type`: `"options"`; `value`: [`OptionId`](OptionId.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"options"` | - |
| `value` | [`OptionId`](OptionId.md)[] | The selected option ids; one for single-select columns. |

***

### Type Literal

\{ `type`: `"entities"`; `value`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"entities"` | - |
| `value` | `string`[] | The referenced entity ids; one for single-valued columns. |

***

### Type Literal

\{ `type`: `"row"`; `value`: [`RowId`](RowId.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"row"` | - |
| `value` | [`RowId`](RowId.md) | A table row's own id, the `row_id` column. |
