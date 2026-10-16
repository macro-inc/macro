# Type Alias: LayoutProblem

> **LayoutProblem** = \{ `kind`: `"bookingMustBeLast"`; \} \| \{ `column`: `string`; `kind`: `"unknownColumn"`; \} \| \{ `column`: `string`; `kind`: `"managedColumn"`; \} \| \{ `column`: `string`; `kind`: `"repeatedColumn"`; \} \| \{ `id`: `string`; `kind`: `"repeatedId"`; \} \| \{ `column`: `string`; `kind`: `"gateNamesLaterColumn"`; \} \| \{ `kind`: `"gateRule"`; `reason`: `string`; \} \| \{ `kind`: `"textTooLong"`; `max`: `number`; \}

Why a layout does not fit the form's table.

## Union Members

### Type Literal

\{ `kind`: `"bookingMustBeLast"`; \}

***

### Type Literal

\{ `column`: `string`; `kind`: `"unknownColumn"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `column` | `string` | The column. |
| `kind` | `"unknownColumn"` | - |

***

### Type Literal

\{ `column`: `string`; `kind`: `"managedColumn"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `column` | `string` | The column. |
| `kind` | `"managedColumn"` | - |

***

### Type Literal

\{ `column`: `string`; `kind`: `"repeatedColumn"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `column` | `string` | The column. |
| `kind` | `"repeatedColumn"` | - |

***

### Type Literal

\{ `id`: `string`; `kind`: `"repeatedId"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | The id. |
| `kind` | `"repeatedId"` | - |

***

### Type Literal

\{ `column`: `string`; `kind`: `"gateNamesLaterColumn"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `column` | `string` | The column. |
| `kind` | `"gateNamesLaterColumn"` | - |

***

### Type Literal

\{ `kind`: `"gateRule"`; `reason`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"gateRule"` | - |
| `reason` | `string` | Why. |

***

### Type Literal

\{ `kind`: `"textTooLong"`; `max`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"textTooLong"` | - |
| `max` | `number` | The longest allowed. |
