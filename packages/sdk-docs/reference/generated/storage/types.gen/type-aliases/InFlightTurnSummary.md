# Type Alias: InFlightTurnSummary

> **InFlightTurnSummary** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `actor?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `announcement_message_id?`: `string` \| `null`; `turn`: `number`; \}

A turn the runtime never answered: the session stopped underneath it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The action that opened the turn. |
| <a id="property-actor"></a> `actor?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-announcement_message_id"></a> `announcement_message_id?` | `string` \| `null` | The magic-chip message posted for this turn, when one was. |
| <a id="property-turn"></a> `turn` | `number` | Position in the session's log. |
