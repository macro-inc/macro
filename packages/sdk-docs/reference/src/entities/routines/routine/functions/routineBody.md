# Function: routineBody()

> **routineBody**(`options`): \{ `enabled`: `boolean` \| `undefined`; `kind`: `"Agent"`; `name`: `string`; `run_visibility`: [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) \| `undefined`; `task`: \{ `agent?`: [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null`; `mcp_servers?`: [`AgentMcpServer`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentMcpServer.md)[]; `model?`: `string` \| `null`; `prompt`: `string`; `user_prompt`: `string`; \}; `trigger`: [`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md); \}

Translate typed routine options into the generated wire contract.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../interfaces/RoutineOptions.md) |

## Returns

\{ `enabled`: `boolean` \| `undefined`; `kind`: `"Agent"`; `name`: `string`; `run_visibility`: [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) \| `undefined`; `task`: \{ `agent?`: [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null`; `mcp_servers?`: [`AgentMcpServer`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentMcpServer.md)[]; `model?`: `string` \| `null`; `prompt`: `string`; `user_prompt`: `string`; \}; `trigger`: [`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md); \}

| Name | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `enabled` | `boolean` \| `undefined` | `options.enabled` | - |
| `kind` | `"Agent"` | - | - |
| `name` | `string` | `options.name` | - |
| `run_visibility` | [`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md) \| `undefined` | `options.runVisibility` | - |
| `task` | \{ `agent?`: [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null`; `mcp_servers?`: [`AgentMcpServer`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentMcpServer.md)[]; `model?`: `string` \| `null`; `prompt`: `string`; `user_prompt`: `string`; \} | - | - |
| `task.agent?` | [`AgentTaskAgent`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentTaskAgent.md) \| `null` | - | - |
| `task.mcp_servers?` | [`AgentMcpServer`](../../../../../generated/scheduled-action/types.gen/type-aliases/AgentMcpServer.md)[] | - | Apps the routine requires on top of the agent's own. The owner must have each one connected to save the routine and for it to run. |
| `task.model?` | `string` \| `null` | - | - |
| `task.prompt` | `string` | - | Instructions placed before the user's. |
| `task.user_prompt` | `string` | - | What the agent should do. |
| `trigger` | [`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md) | - | - |
