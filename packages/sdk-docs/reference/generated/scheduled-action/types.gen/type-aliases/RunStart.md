# Type Alias: RunStart

> **RunStart** = \{ `kind`: `"schedule"`; `schedule`: `string`; `timezone`: `string`; \} \| \{ `entity_id?`: `string` \| `null`; `event`: `string`; `kind`: `"event"`; \} \| \{ `by`: `string`; `kind`: `"manual"`; \}

What started a run, for its page.

## Union Members

### Type Literal

\{ `kind`: `"schedule"`; `schedule`: `string`; `timezone`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"schedule"` | - |
| `schedule` | `string` | The cron expression. |
| `timezone` | `string` | Its IANA time zone. |

***

### Type Literal

\{ `entity_id?`: `string` \| `null`; `event`: `string`; `kind`: `"event"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `entity_id?` | `string` \| `null` | The item the event is about. |
| `event` | `string` | The event's name, e.g. `email.message_received`. |
| `kind` | `"event"` | - |

***

### Type Literal

\{ `by`: `string`; `kind`: `"manual"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `by` | `string` | Who started it. |
| `kind` | `"manual"` | - |
