# Type Alias: SingleRoutineTrigger

> **SingleRoutineTrigger** = `Extract`\<[`RoutineTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTrigger.md), \{ `type`: `"cron"`; \}\> \| `Extract`\<[`RoutineTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTrigger.md), \{ `type`: `"once"`; \}\> \| \{ `filters`: [`RoutineEventFilter`](RoutineEventFilter.md)[]; `type`: `"events"`; \}

One schedule, one exact time, or one set of event selectors. A `once`
trigger runs a single time at `at` (RFC 3339), within about a second; a time
already past runs as soon as the routine is saved. Use it to check back on
something later instead of waiting inside a program.
