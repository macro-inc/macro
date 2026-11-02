# Type Alias: SystemStatus

> **SystemStatus** = \{ `status`: `"operational"`; \} \| \{ `message`: `string`; `status`: `"degraded"`; \} \| \{ `message`: `string`; `status`: `"major_outage"`; \}

The platform status. Only the non-operational statuses carry a message.

## Union Members

### Type Literal

\{ `status`: `"operational"`; \}

***

### Type Literal

\{ `message`: `string`; `status`: `"degraded"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | What users should know. |
| `status` | `"degraded"` | - |

***

### Type Literal

\{ `message`: `string`; `status`: `"major_outage"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | What users should know. |
| `status` | `"major_outage"` | - |
