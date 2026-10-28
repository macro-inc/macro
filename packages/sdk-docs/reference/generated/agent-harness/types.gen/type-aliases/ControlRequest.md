# Type Alias: ControlRequest

> **ControlRequest** = [`AgentAction`](AgentAction.md) & \{ `actionId?`: `null` \| [`AgentActionId`](AgentActionId.md); `context?`: \{\[`key`: `string`\]: `unknown`; \} \| `null`; \}

Request body for a control operation on a live session.

A wrapper around the operation rather than the bare enum so that fields
which are about the request rather than the operation have somewhere to go.
The acting user is deliberately not one of them: it comes from the caller's
credentials, so that a caller cannot attribute an operation to someone else.

Clients serialize this, so both derives are used.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `actionId?` | `null` \| [`AgentActionId`](AgentActionId.md) | - |
| `context?` | \{\[`key`: `string`\]: `unknown`; \} \| `null` | Why the agent is being asked. Only a runtime forwarding a triggered prompt may send it; a user's request carrying it is refused. |
