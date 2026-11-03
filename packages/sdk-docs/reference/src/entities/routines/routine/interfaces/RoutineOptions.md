# Interface: RoutineOptions

Configuration of an agent routine.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent"></a> `agent?` | [`Agent`](../../../agents/agent/classes/Agent.md) | Agent to run the task: a built-in agent, or one the caller owns or can use, including one on a self-hosted runtime. Access is checked on save and again on every run. Set `model`, `agent`, or both. |
| <a id="property-enabled"></a> `enabled?` | `boolean` | Whether triggers can start executions. Defaults to true on creation. |
| <a id="property-model"></a> `model?` | `string` | Model to run the task, e.g. `anthropic/claude-sonnet-5-5`, or the model override for `agent`. Set `model`, `agent`, or both. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-prompt"></a> `prompt` | `string` | Instructions delivered to the agent. |
| <a id="property-runvisibility"></a> `runVisibility?` | [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) | Whether runs appear in Home and the Agents list. Defaults to `unlisted` on creation; an update that omits it keeps the stored value. |
| <a id="property-trigger"></a> `trigger` | [`RoutineTriggerOptions`](../type-aliases/RoutineTriggerOptions.md) | Schedules or Macro events that start the routine. A cron `schedule` has 6 or 7 fields: `sec min hour day-of-month month day-of-week [year]`. |
| <a id="property-userprompt"></a> `userPrompt` | `string` | Original user instructions. |
