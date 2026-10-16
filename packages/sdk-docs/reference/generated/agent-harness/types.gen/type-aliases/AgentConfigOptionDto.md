# Type Alias: AgentConfigOptionDto

> **AgentConfigOptionDto** = [`AgentConfigKindDto`](AgentConfigKindDto.md) & \{ `category?`: `string` \| `null`; `description?`: `string` \| `null`; `id`: `string`; `name`: `string`; \}

One agent-advertised ACP session setting.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `category?` | `string` \| `null` | ACP semantic category, such as `model` or `thought_level`. |
| `description?` | `string` \| `null` | Optional explanatory copy. |
| `id` | `string` | Opaque id used to change this setting. |
| `name` | `string` | Display label supplied by the agent. |
