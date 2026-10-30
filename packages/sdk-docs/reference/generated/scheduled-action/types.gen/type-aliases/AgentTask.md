# Type Alias: AgentTask

> **AgentTask** = \{ `agent?`: `null` \| [`AgentTaskAgent`](AgentTaskAgent.md); `mcp_servers?`: [`AgentMcpServer`](AgentMcpServer.md)[]; `model?`: `null` \| [`RoutineModelId`](RoutineModelId.md); `prompt`: `string`; `user_prompt`: `string`; \}

The single agent task: how routines were stored before they had steps,
and still how a routine that is only an agent is saved.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent"></a> `agent?` | `null` \| [`AgentTaskAgent`](AgentTaskAgent.md) | - |
| <a id="property-mcp_servers"></a> `mcp_servers?` | [`AgentMcpServer`](AgentMcpServer.md)[] | Apps the routine requires on top of the agent's own. The owner must have each one connected to save the routine and for it to run. |
| <a id="property-model"></a> `model?` | `null` \| [`RoutineModelId`](RoutineModelId.md) | - |
| <a id="property-prompt"></a> `prompt` | `string` | Instructions placed before the user's. |
| <a id="property-user_prompt"></a> `user_prompt` | `string` | What the agent should do. |
