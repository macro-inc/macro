# Type Alias: RoutineOptions

> **RoutineOptions** = \{ `enabled?`: `boolean`; `name`: `string`; `prompt`: `string`; `runVisibility?`: [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md); `trigger`: [`RoutineTriggerOptions`](RoutineTriggerOptions.md); `userPrompt`: `string`; \} & [`RoutineTargetOptions`](RoutineTargetOptions.md)

Configuration of an agent routine.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `enabled?` | `boolean` | Whether triggers can start executions. Defaults to true on creation. |
| `name` | `string` | Display name. |
| `prompt` | `string` | Instructions delivered to the agent. |
| `runVisibility?` | [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) | Whether runs appear in Home and the Agents list. Defaults to `unlisted` on creation; an update that omits it keeps the stored value. |
| `trigger` | [`RoutineTriggerOptions`](RoutineTriggerOptions.md) | Schedules or Macro events that start the routine. Cron uses five- or six-field `schedule` and an IANA `timezone`. |
| `userPrompt` | `string` | Original user instructions. |
