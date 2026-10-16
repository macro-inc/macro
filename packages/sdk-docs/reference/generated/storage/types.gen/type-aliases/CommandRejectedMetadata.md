# Type Alias: CommandRejectedMetadata

> **CommandRejectedMetadata** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `actor?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `announcement_message_id?`: `string` \| `null`; `failure`: [`CommandFailure`](CommandFailure.md); `identity`: [`SessionIdentity`](SessionIdentity.md); \}

An accepted command was refused before it could start a runtime turn.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The command that will not execute. |
| <a id="property-actor"></a> `actor?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-announcement_message_id"></a> `announcement_message_id?` | `string` \| `null` | The command's thread announcement, when one was created. |
| <a id="property-failure"></a> `failure` | [`CommandFailure`](CommandFailure.md) | Safe details for clients and downstream consumers. |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
