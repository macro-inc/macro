# Type Alias: Formula

> **Formula** = \{ `column`: `string`; `kind`: `"column"`; \} \| \{ `kind`: `"number"`; `value`: `number`; \} \| \{ `kind`: `"binary"`; `left`: `Formula`; `operator`: [`Operator`](Operator.md); `right`: `Formula`; \} \| \{ `kind`: `"negate"`; `operand`: `Formula`; \}

An expression over one row's cells.

## Union Members

### Type Literal

\{ `column`: `string`; `kind`: `"column"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `column` | `string` | The column placement. |
| `kind` | `"column"` | - |

***

### Type Literal

\{ `kind`: `"number"`; `value`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"number"` | - |
| `value` | `number` | The value; finite. |

***

### Type Literal

\{ `kind`: `"binary"`; `left`: `Formula`; `operator`: [`Operator`](Operator.md); `right`: `Formula`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"binary"` | - |
| `left` | `Formula` | The left operand. |
| `operator` | [`Operator`](Operator.md) | How. |
| `right` | `Formula` | The right operand. |

***

### Type Literal

\{ `kind`: `"negate"`; `operand`: `Formula`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"negate"` | - |
| `operand` | `Formula` | The expression negated; a number. |
