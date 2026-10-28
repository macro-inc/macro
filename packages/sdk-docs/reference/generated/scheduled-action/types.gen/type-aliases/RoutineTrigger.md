# Type Alias: RoutineTrigger

> **RoutineTrigger** = \{ `schedule`: [`Schedule`](Schedule.md); `timezone`: `string`; `type`: `"cron"`; \} \| \{ `filters`: [`EventFilters`](EventFilters.md); `type`: `"events"`; \}

An individual trigger in a routine's trigger list.
