# Type Alias: TurnSummary

> **TurnSummary** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `actor?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `announcement_message_id?`: `string` \| `null`; `excerpt?`: `string` \| `null`; `stop_reason`: `string`; `turn`: `number`; \}

A turn the runtime answered.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The action that opened the turn. |
| <a id="property-actor"></a> `actor?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-announcement_message_id"></a> `announcement_message_id?` | `string` \| `null` | The magic-chip message posted for this turn, when one was. |
| <a id="property-excerpt"></a> `excerpt?` | `string` \| `null` | The agent's last text in the turn, whole; what the magic chip shows once the turn ends. `None` when the turn produced no prose. |
| <a id="property-stop_reason"></a> `stop_reason` | `string` | The ACP stop reason, or `"error"` when the runtime refused the prompt. |
| <a id="property-turn"></a> `turn` | `number` | Position in the session's log. |
