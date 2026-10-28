# Type Alias: SessionStatusDto

> **SessionStatusDto** = \{ `kind`: `"no_messages"`; \} \| \{ `event`: `string`; `kind`: `"event"`; \} \| \{ `kind`: `"disconnected"`; \}

Transport representation of a session's status, mirroring
[`SessionStatus`].

## Union Members

### Type Literal

\{ `kind`: `"no_messages"`; \}

***

### Type Literal

\{ `event`: `string`; `kind`: `"event"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event` | `string` | The wire name of the system event, e.g. `acp_ready`. |
| `kind` | `"event"` | - |

***

### Type Literal

\{ `kind`: `"disconnected"`; \}
