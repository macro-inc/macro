# Type Alias: AgentConversationTurnDto

> **AgentConversationTurnDto** = \{ `actionId`: `string`; `createdAt`: `string`; `replyMessageId?`: `string` \| `null`; `retryable`: `boolean`; `sessionId`: `string`; `sourceMessageId`: `string`; `state`: [`ConversationTurnState`](ConversationTurnState.md); \}

Execution status without exposing the persona prompt or stored credentials.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actionid"></a> `actionId` | `string` | Current runtime attempt identity. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the source message was first accepted. |
| <a id="property-replymessageid"></a> `replyMessageId?` | `string` \| `null` | The associated agent reply, if it has been posted. |
| <a id="property-retryable"></a> `retryable` | `boolean` | Whether Retry would be accepted now. A failed attempt is not retryable until its reply says how it ended. |
| <a id="property-sessionid"></a> `sessionId` | `string` | Session carrying this turn. |
| <a id="property-sourcemessageid"></a> `sourceMessageId` | `string` | The user's message in the channel timeline. |
| <a id="property-state"></a> `state` | [`ConversationTurnState`](ConversationTurnState.md) | Durable execution state. |
