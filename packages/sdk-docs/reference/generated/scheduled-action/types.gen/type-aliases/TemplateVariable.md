# Type Alias: TemplateVariable

> **TemplateVariable** = \{ `fill`: [`VariableFill`](VariableFill.md); `id`: `string`; `kind`: `"user"`; `label`: `string`; \} \| \{ `block_name`: `string`; `fill`: [`VariableFill`](VariableFill.md); `id`: `string`; `kind`: `"item"`; `label`: `string`; \} \| \{ `fill`: [`VariableFill`](VariableFill.md); `kind`: `"time_zone"`; `timezone`: `string`; \}

A user-specific part of a shared routine.

## Union Members

### Type Literal

\{ `fill`: [`VariableFill`](VariableFill.md); `id`: `string`; `kind`: `"user"`; `label`: `string`; \}

***

### Type Literal

\{ `block_name`: `string`; `fill`: [`VariableFill`](VariableFill.md); `id`: `string`; `kind`: `"item"`; `label`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `block_name` | `string` | The mention's block name, such as `channel` or `md`. |
| `fill` | [`VariableFill`](VariableFill.md) | - |
| `id` | `string` | - |
| `kind` | `"item"` | - |
| `label` | `string` | - |

***

### Type Literal

\{ `fill`: [`VariableFill`](VariableFill.md); `kind`: `"time_zone"`; `timezone`: `string`; \}
