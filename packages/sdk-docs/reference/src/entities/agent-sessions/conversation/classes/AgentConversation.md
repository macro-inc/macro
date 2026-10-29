# Class: AgentConversation

An agent's conversation in one channel.

## Constructors

### Constructor

> **new AgentConversation**(`client`, `channel`, `record`): `AgentConversation`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `client` | `MacroClient` | - |
| `channel` | [`Channel`](../../../channels/channel/classes/Channel.md) | Parent channel. |
| `record` | [`AgentConversationDto`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentConversationDto.md) | - |

#### Returns

`AgentConversation`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-channel"></a> `channel` | `readonly` | [`Channel`](../../../channels/channel/classes/Channel.md) | Parent channel. |

## Methods

### agent()

> **agent**(): [`Agent`](../../../agents/agent/classes/Agent.md)

The agent taking part.

#### Returns

[`Agent`](../../../agents/agent/classes/Agent.md)

***

### sessions()

> **sessions**(): \{ `createdAt`: `string`; `isCurrent`: `boolean`; `session`: [`AgentSession`](../../agent-session/classes/AgentSession.md); \}[]

Conversation sessions with their current flag.

#### Returns

\{ `createdAt`: `string`; `isCurrent`: `boolean`; `session`: [`AgentSession`](../../agent-session/classes/AgentSession.md); \}[]

***

### startFresh()

> **startFresh**(`session`): `Promise`\<`void`\>

Start a fresh conversation from one of its sessions.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `agentId`: `string`; `channelId`: `string`; \}

Serialize scoped identity.

#### Returns

\{ `agentId`: `string`; `channelId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `agentId` | `string` |
| `channelId` | `string` |

***

### turns()

> **turns**(): [`ConversationTurn`](ConversationTurn.md)[]

Recorded conversation turns.

#### Returns

[`ConversationTurn`](ConversationTurn.md)[]
