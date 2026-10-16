# Type Alias: ControlResponse

> **ControlResponse** = \{ `actionId`: [`AgentActionId`](AgentActionId.md); `status`: [`ControlStatusDto`](ControlStatusDto.md); \}

Response body for a control operation.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actionid"></a> `actionId` | [`AgentActionId`](AgentActionId.md) | Matches `requestId` on the folded message this action derives once it dispatches, and names the queue entry until then. The caller's own `actionId` when it supplied one; a freshly minted id otherwise. |
| <a id="property-status"></a> `status` | [`ControlStatusDto`](ControlStatusDto.md) | Whether the action went out or waits in the queue. |
