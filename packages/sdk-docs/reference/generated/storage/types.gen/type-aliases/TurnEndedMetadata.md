# Type Alias: TurnEndedMetadata

> **TurnEndedMetadata** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `actor?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `announcement_message_id?`: `string` \| `null`; `identity`: [`SessionIdentity`](SessionIdentity.md); `queued_remaining`: `number`; `stop_reason`: `string`; `turn`: `number`; \}

The runtime answered a turn. Another prompt may follow at once; see
[`SessionSettledMetadata`] for "nothing left to do".

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The action that opened the turn. |
| <a id="property-actor"></a> `actor?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-announcement_message_id"></a> `announcement_message_id?` | `string` \| `null` | The magic-chip message posted for this turn, when one was. |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
| <a id="property-queued_remaining"></a> `queued_remaining` | `number` | Prompts still waiting behind this turn. |
| <a id="property-stop_reason"></a> `stop_reason` | `string` | The ACP stop reason, or `"error"` when the runtime refused the prompt. |
| <a id="property-turn"></a> `turn` | `number` | Position in the session's log. |
