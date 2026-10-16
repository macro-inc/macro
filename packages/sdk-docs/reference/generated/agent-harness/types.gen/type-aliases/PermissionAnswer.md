# Type Alias: PermissionAnswer

> **PermissionAnswer** = \{ `kind`: `"selected"`; `optionId`: `string`; \} \| \{ `kind`: `"cancelled"`; \}

The decision carried by an [`AgentPermissionAction`].

## Union Members

### Type Literal

\{ `kind`: `"selected"`; `optionId`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"selected"` | - |
| `optionId` | `string` | The chosen option's id, as the agent listed it. |

***

### Type Literal

\{ `kind`: `"cancelled"`; \}
