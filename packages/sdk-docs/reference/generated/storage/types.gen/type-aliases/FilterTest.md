# Type Alias: FilterTest

> **FilterTest** = \{ `kind`: `"presence"`; `operator`: [`PresenceOperator`](PresenceOperator.md); \} \| \{ `kind`: `"text"`; `operator`: [`TextOperator`](TextOperator.md); `value`: `string`; \} \| \{ `kind`: `"number"`; `operator`: [`NumberOperator`](NumberOperator.md); `value`: `number`; \} \| \{ `kind`: `"date"`; `operator`: [`DateOperator`](DateOperator.md); `value`: `string`; \} \| \{ `checked`: `boolean`; `kind`: `"checkbox"`; \} \| \{ `kind`: `"options"`; `operator`: [`SetOperator`](SetOperator.md); `options`: `string`[]; \} \| \{ `entities`: `string`[]; `kind`: `"entities"`; `operator`: [`SetOperator`](SetOperator.md); \}

What a column's cell must be, by the kind of value the column holds.

## Union Members

### Type Literal

\{ `kind`: `"presence"`; `operator`: [`PresenceOperator`](PresenceOperator.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"presence"` | - |
| `operator` | [`PresenceOperator`](PresenceOperator.md) | Empty, or not. |

***

### Type Literal

\{ `kind`: `"text"`; `operator`: [`TextOperator`](TextOperator.md); `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"text"` | - |
| `operator` | [`TextOperator`](TextOperator.md) | How the cell compares. |
| `value` | `string` | The text compared against, ignoring case for the containment tests. |

***

### Type Literal

\{ `kind`: `"number"`; `operator`: [`NumberOperator`](NumberOperator.md); `value`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"number"` | - |
| `operator` | [`NumberOperator`](NumberOperator.md) | How the cell compares. |
| `value` | `number` | The number compared against; finite. |

***

### Type Literal

\{ `kind`: `"date"`; `operator`: [`DateOperator`](DateOperator.md); `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"date"` | - |
| `operator` | [`DateOperator`](DateOperator.md) | How the cell compares. |
| `value` | `string` | The date-time compared against. |

***

### Type Literal

\{ `checked`: `boolean`; `kind`: `"checkbox"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `checked` | `boolean` | Whether the box is checked. |
| `kind` | `"checkbox"` | - |

***

### Type Literal

\{ `kind`: `"options"`; `operator`: [`SetOperator`](SetOperator.md); `options`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"options"` | - |
| `operator` | [`SetOperator`](SetOperator.md) | How the cell's options relate to these. |
| `options` | `string`[] | Options of the column; at least one. |

***

### Type Literal

\{ `entities`: `string`[]; `kind`: `"entities"`; `operator`: [`SetOperator`](SetOperator.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `entities` | `string`[] | Entity ids, or for a relation the related rows' ids; at least one. |
| `kind` | `"entities"` | - |
| `operator` | [`SetOperator`](SetOperator.md) | How the cell's references relate to these. |
