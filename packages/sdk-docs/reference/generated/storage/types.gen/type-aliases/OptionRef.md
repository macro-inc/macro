# Type Alias: OptionRef

> **OptionRef** = \{ `id`: `string`; \} \| \{ `label`: `string`; \}

A select option, by its id or by its label.

## Union Members

### Type Literal

\{ `id`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | An option the column has. |

***

### Type Literal

\{ `label`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `label` | `string` | An option's label, matched without regard to case. An unknown label is refused. |
