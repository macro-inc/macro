# Type Alias: InvitationDateTime

> **InvitationDateTime** = \{ `kind`: `"date"`; `value`: `string`; \} \| \{ `kind`: `"zoned"`; `time_zone`: `string`; `value`: `string`; \} \| \{ `kind`: `"unresolved"`; `time_zone?`: `string` \| `null`; `value`: `string`; \}

Preserve date-only and unresolved times without manufacturing UTC instants.

## Union Members

### Type Literal

\{ `kind`: `"date"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"date"` | - |
| `value` | `string` | ISO calendar date. |

***

### Type Literal

\{ `kind`: `"zoned"`; `time_zone`: `string`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"zoned"` | - |
| `time_zone` | `string` | IANA zone of the original TZID, or UTC. |
| `value` | `string` | RFC3339 instant. |

***

### Type Literal

\{ `kind`: `"unresolved"`; `time_zone?`: `string` \| `null`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"unresolved"` | - |
| `time_zone?` | `string` \| `null` | Original TZID if present. |
| `value` | `string` | ISO local wall time, without an offset. |
