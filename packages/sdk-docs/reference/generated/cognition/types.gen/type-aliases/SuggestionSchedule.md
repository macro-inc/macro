# Type Alias: SuggestionSchedule

> **SuggestionSchedule** = \{ `frequency`: `"hour"`; \} \| \{ `frequency`: `"day"`; `time`: [`ClockTime`](ClockTime.md); \} \| \{ `frequency`: `"week"`; `time`: [`ClockTime`](ClockTime.md); `weekdays`: [`Weekday`](Weekday.md)[]; \} \| \{ `dayOfMonth`: `number`; `frequency`: `"month"`; `time`: [`ClockTime`](ClockTime.md); \}

How often a scheduled suggestion runs, in the user's time zone.

## Union Members

### Type Literal

\{ `frequency`: `"hour"`; \}

***

### Type Literal

\{ `frequency`: `"day"`; `time`: [`ClockTime`](ClockTime.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `frequency` | `"day"` | - |
| `time` | [`ClockTime`](ClockTime.md) | Local time of day. |

***

### Type Literal

\{ `frequency`: `"week"`; `time`: [`ClockTime`](ClockTime.md); `weekdays`: [`Weekday`](Weekday.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `frequency` | `"week"` | - |
| `time` | [`ClockTime`](ClockTime.md) | Local time of day. |
| `weekdays` | [`Weekday`](Weekday.md)[] | The days to run; never empty, never repeated. |

***

### Type Literal

\{ `dayOfMonth`: `number`; `frequency`: `"month"`; `time`: [`ClockTime`](ClockTime.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `dayOfMonth` | `number` | 1-28, so it exists in every month. |
| `frequency` | `"month"` | - |
| `time` | [`ClockTime`](ClockTime.md) | Local time of day. |
