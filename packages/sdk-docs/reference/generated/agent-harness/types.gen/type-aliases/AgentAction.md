# Type Alias: AgentAction

> **AgentAction** = [`AgentPromptAction`](AgentPromptAction.md) & \{ `type`: `"prompt"`; \} \| [`AgentSetModelAction`](AgentSetModelAction.md) & \{ `type`: `"setModel"`; \} \| [`AgentSetConfigOptionAction`](AgentSetConfigOptionAction.md) & \{ `type`: `"setConfigOption"`; \} \| \{ `type`: `"compact"`; \} \| \{ `type`: `"stop"`; \} \| [`AgentRespondElicitationAction`](AgentRespondElicitationAction.md) & \{ `type`: `"respondElicitation"`; \} \| [`AgentPermissionAction`](AgentPermissionAction.md) & \{ `type`: `"respondToPermission"`; \}

One thing a caller wants an agent to do.
