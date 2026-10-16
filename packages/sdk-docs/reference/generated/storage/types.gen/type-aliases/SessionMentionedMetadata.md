# Type Alias: SessionMentionedMetadata

> **SessionMentionedMetadata** = \{ `action_id`: [`AgentActionId`](AgentActionId.md); `identity`: [`SessionIdentity`](SessionIdentity.md); `mentioned`: [`MacroUserIdStr`](MacroUserIdStr.md)[]; `mentioned_by?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `origin_message_id?`: `string` \| `null`; \}

A prompt named other users who can open the session. Published when the
prompt is accepted, not when it is answered: "come look at this" should
not wait for the turn.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | [`AgentActionId`](AgentActionId.md) | The action carrying the prompt. |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
| <a id="property-mentioned"></a> `mentioned` | [`MacroUserIdStr`](MacroUserIdStr.md)[] | The users named, already narrowed to those who can open the session and never including the author. |
| <a id="property-mentioned_by"></a> `mentioned_by?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-origin_message_id"></a> `origin_message_id?` | `string` \| `null` | The channel or document message the prompt was posted as, when it arrived from a thread rather than the session view. That message already notified the users it named when it was posted. |
