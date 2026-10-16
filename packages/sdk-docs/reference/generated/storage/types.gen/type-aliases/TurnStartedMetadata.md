# Type Alias: TurnStartedMetadata

> **TurnStartedMetadata** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `actor?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `announcement_message_id?`: `string` \| `null`; `identity`: [`SessionIdentity`](SessionIdentity.md); `turn`: `number`; \}

A prompt was delivered to the runtime.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The action that opened the turn. |
| <a id="property-actor"></a> `actor?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-announcement_message_id"></a> `announcement_message_id?` | `string` \| `null` | The magic-chip message posted for this turn, when one was. |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
| <a id="property-turn"></a> `turn` | `number` | Position in the session's log. |
