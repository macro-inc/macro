# Type Alias: TallyValue

> **TallyValue** = \{ `kind`: `"option"`; `option`: `string`; \} \| \{ `checked`: `boolean`; `kind`: `"checkbox"`; \}

A value a tally counts.

## Union Members

### Type Literal

\{ `kind`: `"option"`; `option`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"option"` | - |
| `option` | `string` | The option. |

***

### Type Literal

\{ `checked`: `boolean`; `kind`: `"checkbox"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `checked` | `boolean` | Checked, or not. |
| `kind` | `"checkbox"` | - |
