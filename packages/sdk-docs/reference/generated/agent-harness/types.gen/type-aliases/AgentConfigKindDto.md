# Type Alias: AgentConfigKindDto

> **AgentConfigKindDto** = \{ `currentValue`: `string`; `options`: [`AgentConfigSelectOptionDto`](AgentConfigSelectOptionDto.md)[]; `type`: `"select"`; \} \| \{ `currentValue`: `boolean`; `type`: `"boolean"`; \}

Type-specific state for one agent session setting.

## Union Members

### Type Literal

\{ `currentValue`: `string`; `options`: [`AgentConfigSelectOptionDto`](AgentConfigSelectOptionDto.md)[]; `type`: `"select"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `currentValue` | `string` | Current opaque value. |
| `options` | [`AgentConfigSelectOptionDto`](AgentConfigSelectOptionDto.md)[] | Ordered values supplied by the agent. |
| `type` | `"select"` | - |

***

### Type Literal

\{ `currentValue`: `boolean`; `type`: `"boolean"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `currentValue` | `boolean` | Current value. |
| `type` | `"boolean"` | - |
