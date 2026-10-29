# Type Alias: AgentConversationSessionDto

> **AgentConversationSessionDto** = \{ `createdAt`: `string`; `isCurrent`: `boolean`; `sessionId`: `string`; \}

One session a conversation has run on; every channel message stays visible.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the session began. |
| <a id="property-iscurrent"></a> `isCurrent` | `boolean` | Whether this is the current agent context. |
| <a id="property-sessionid"></a> `sessionId` | `string` | Session whose controls and live events belong to this context. |
