# Type Alias: ActionTrigger

> **ActionTrigger** = \{ `schedule`: [`Schedule`](Schedule.md); `timezone`: `string`; `type`: `"cron"`; \} \| \{ `filters`: [`EventFilters`](EventFilters.md); `type`: `"events"`; \} \| \{ `at`: `string`; `type`: `"once"`; \} \| \{ `triggers`: [`RoutineTriggers`](RoutineTriggers.md); `type`: `"multiple"`; \}

A routine may run on one trigger or any of several schedules and Macro events.
