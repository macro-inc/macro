# Type Alias: SuggestionTrigger

> **SuggestionTrigger** = \{ `condition?`: `string` \| `null`; `event`: [`SuggestedEvent`](SuggestedEvent.md); `kind`: `"event"`; \} \| \{ `kind`: `"schedule"`; `schedule`: [`SuggestionSchedule`](SuggestionSchedule.md); \}

When a suggested routine runs.

## Union Members

### Type Literal

\{ `condition?`: `string` \| `null`; `event`: [`SuggestedEvent`](SuggestedEvent.md); `kind`: `"event"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `condition?` | `string` \| `null` | A yes/no question the event must answer yes to before the routine runs, e.g. "Is this email an invoice or a receipt?". |
| `event` | [`SuggestedEvent`](SuggestedEvent.md) | The event. |
| `kind` | `"event"` | - |

***

### Type Literal

\{ `kind`: `"schedule"`; `schedule`: [`SuggestionSchedule`](SuggestionSchedule.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"schedule"` | - |
| `schedule` | [`SuggestionSchedule`](SuggestionSchedule.md) | The schedule. |
