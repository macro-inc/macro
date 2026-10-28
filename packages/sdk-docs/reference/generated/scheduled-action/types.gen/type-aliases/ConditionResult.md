# Type Alias: ConditionResult

> **ConditionResult** = \{ `probability`: `number`; `status`: `"not_met"`; \} \| \{ `status`: `"unavailable"`; \}

Why an event-triggered run was skipped before it started.

## Union Members

### Type Literal

\{ `probability`: `number`; `status`: `"not_met"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `probability` | `number` | The classifier's probability, from 0 to 1, that the answer was yes. |
| `status` | `"not_met"` | - |

***

### Type Literal

\{ `status`: `"unavailable"`; \}
