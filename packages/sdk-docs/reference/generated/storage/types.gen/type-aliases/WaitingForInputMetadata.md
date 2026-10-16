# Type Alias: WaitingForInputMetadata

> **WaitingForInputMetadata** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `announcement_message_id?`: `string` \| `null`; `identity`: [`SessionIdentity`](SessionIdentity.md); `question`: `string`; `turn`: `number`; \}

The agent asked its owner a question and is blocked on the answer.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The action that opened the turn. |
| <a id="property-announcement_message_id"></a> `announcement_message_id?` | `string` \| `null` | The magic-chip message posted for this turn, when one was. |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
| <a id="property-question"></a> `question` | `string` | The question, as the agent phrased it. |
| <a id="property-turn"></a> `turn` | `number` | The turn asking. |
