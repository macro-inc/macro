# Type Alias: AssistantMessagePart

> **AssistantMessagePart** = \{ `text`: `string`; `type`: `"text"`; \} \| \{ `id`: `string`; `json`: `unknown`; `name`: `string`; `type`: `"toolCall"`; \} \| \{ `display_name?`: `string` \| `null`; `id`: `string`; `json`: `unknown`; `name`: `string`; `service`: `string`; `type`: `"mcpToolCall"`; \} \| \{ `id`: `string`; `json`: `unknown`; `name`: `string`; `type`: `"toolCallResponseJson"`; \} \| \{ `description`: `string`; `id`: `string`; `name`: `string`; `type`: `"toolCallErr"`; \} \| \{ `thinking`: `string`; `type`: `"thinking"`; \}

A structured part within an assistant message.

When the model responds with tool calls the full turn is persisted as a
flat sequence of these parts.  [`crate::convert::to_rig_messages`]
reconstructs the turn boundaries that providers expect.

## Union Members

### Type Literal

\{ `text`: `string`; `type`: `"text"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `text` | `string` | The text content. |
| `type` | `"text"` | - |

***

### Type Literal

\{ `id`: `string`; `json`: `unknown`; `name`: `string`; `type`: `"toolCall"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | Provider-assigned call id. |
| `json` | `unknown` | Tool arguments as JSON. |
| `name` | `string` | Tool name. |
| `type` | `"toolCall"` | - |

***

### Type Literal

\{ `display_name?`: `string` \| `null`; `id`: `string`; `json`: `unknown`; `name`: `string`; `service`: `string`; `type`: `"mcpToolCall"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `display_name?` | `string` \| `null` | Optional human-readable name. |
| `id` | `string` | Provider-assigned call id. |
| `json` | `unknown` | Tool arguments as JSON. |
| `name` | `string` | Tool name. |
| `service` | `string` | MCP service identifier. |
| `type` | `"mcpToolCall"` | - |

***

### Type Literal

\{ `id`: `string`; `json`: `unknown`; `name`: `string`; `type`: `"toolCallResponseJson"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | Corresponding call id. |
| `json` | `unknown` | Response payload. |
| `name` | `string` | Tool name. |
| `type` | `"toolCallResponseJson"` | - |

***

### Type Literal

\{ `description`: `string`; `id`: `string`; `name`: `string`; `type`: `"toolCallErr"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | Human-readable error description. |
| `id` | `string` | Corresponding call id. |
| `name` | `string` | Tool name. |
| `type` | `"toolCallErr"` | - |

***

### Type Literal

\{ `thinking`: `string`; `type`: `"thinking"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `thinking` | `string` | The thinking text content. |
| `type` | `"thinking"` | - |
