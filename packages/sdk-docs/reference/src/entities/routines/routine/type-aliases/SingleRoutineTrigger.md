# Type Alias: SingleRoutineTrigger

> **SingleRoutineTrigger** = `Extract`\<[`RoutineTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTrigger.md), \{ `type`: `"cron"`; \}\> \| \{ `filters`: [`RoutineEventFilter`](RoutineEventFilter.md)[]; `type`: `"events"`; \}

One schedule or set of event selectors.
