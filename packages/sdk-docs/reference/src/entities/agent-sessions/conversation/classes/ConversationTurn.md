# Class: ConversationTurn

One agent conversation turn, identified by its source message.

## Constructors

### Constructor

> **new ConversationTurn**(`client`, `conversation`, `record`): `ConversationTurn`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `client` | `MacroClient` | - |
| `conversation` | [`AgentConversation`](AgentConversation.md) | Parent conversation. |
| `record` | [`AgentConversationTurnDto`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentConversationTurnDto.md) | - |

#### Returns

`ConversationTurn`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-conversation"></a> `conversation` | `readonly` | [`AgentConversation`](AgentConversation.md) | Parent conversation. |

## Methods

### retry()

> **retry**(`actionId`): `Promise`\<`void`\>

Retry with a caller persisted action nonce. Never retries automatically.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `actionId` | `string` |

#### Returns

`Promise`\<`void`\>

***

### session()

> **session**(): [`AgentSession`](../../agent-session/classes/AgentSession.md)

Session that handled this turn.

#### Returns

[`AgentSession`](../../agent-session/classes/AgentSession.md)

***

### source()

> **source**(): [`Message`](../../../channels/message/classes/Message.md)

Originating message.

#### Returns

[`Message`](../../../channels/message/classes/Message.md)

***

### toJSON()

> **toJSON**(): \{ `channelId`: `string`; `sourceMessageId`: `string`; \}

Serialize scoped identity.

#### Returns

\{ `channelId`: `string`; `sourceMessageId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `channelId` | `string` |
| `sourceMessageId` | `string` |
