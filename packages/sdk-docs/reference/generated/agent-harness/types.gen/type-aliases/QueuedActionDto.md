# Type Alias: QueuedActionDto

> **QueuedActionDto** = \{ `actionId`: [`AgentActionId`](AgentActionId.md); `actorUserId?`: `string` \| `null`; `attachments?`: [`PromptAttachment`](PromptAttachment.md)[]; `createdAt`: `string`; `kind`: `string`; `prompt?`: `string` \| `null`; \}

One action waiting in a session's queue.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actionid"></a> `actionId` | [`AgentActionId`](AgentActionId.md) | The id the action was accepted under. |
| <a id="property-actoruserid"></a> `actorUserId?` | `string` \| `null` | The user who queued it, absent when a bot acted on nobody's behalf. |
| <a id="property-attachments"></a> `attachments?` | [`PromptAttachment`](PromptAttachment.md)[] | Files the prompt refers to, for prompts only. Kept through an edit, which replaces the text alone. |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was accepted. |
| <a id="property-kind"></a> `kind` | `string` | What kind of action waits - `prompt` or `compact`; only turn-occupying actions are ever queued. |
| <a id="property-prompt"></a> `prompt?` | `string` \| `null` | The prompt's raw text, present for prompts only. What an edit replaces. |
