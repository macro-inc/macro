# Function: routineBody()

> **routineBody**(`options`): \{ `enabled`: `boolean` \| `undefined`; `kind`: `"Agent"`; `name`: `string`; `run_visibility`: [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) \| `undefined`; `task`: \{ `agent?`: [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null`; `model?`: `string` \| `null`; `prompt`: `string`; `user_prompt`: `string`; \}; `trigger`: [`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md); \}

Translate typed routine options into the generated wire contract.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../interfaces/RoutineOptions.md) |

## Returns

\{ `enabled`: `boolean` \| `undefined`; `kind`: `"Agent"`; `name`: `string`; `run_visibility`: [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) \| `undefined`; `task`: \{ `agent?`: [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null`; `model?`: `string` \| `null`; `prompt`: `string`; `user_prompt`: `string`; \}; `trigger`: [`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md); \}

| Name | Type | Default value |
| ------ | ------ | ------ |
| `enabled` | `boolean` \| `undefined` | `options.enabled` |
| `kind` | `"Agent"` | - |
| `name` | `string` | `options.name` |
| `run_visibility` | [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) \| `undefined` | `options.runVisibility` |
| `task` | \{ `agent?`: [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null`; `model?`: `string` \| `null`; `prompt`: `string`; `user_prompt`: `string`; \} | - |
| `task.agent?` | [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null` | - |
| `task.model?` | `string` \| `null` | - |
| `task.prompt` | `string` | - |
| `task.user_prompt` | `string` | - |
| `trigger` | [`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md) | - |
