# Class: AgentNamespace

Configurable agents.

## Constructors

### Constructor

> **new AgentNamespace**(`client`): `AgentNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`AgentNamespace`

## Methods

### byId()

> **byId**(`id`): [`Agent`](../../agent/classes/Agent.md)

Construct a lazy agent handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Agent`](../../agent/classes/Agent.md)

***

### create()

> **create**(`options`): `Promise`\<[`Agent`](../../agent/classes/Agent.md)\>

Create an agent.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`AgentOptions`](../../agent/type-aliases/AgentOptions.md) |

#### Returns

`Promise`\<[`Agent`](../../agent/classes/Agent.md)\>

***

### list()

> **list**(): `Promise`\<[`Agent`](../../agent/classes/Agent.md)[]\>

All accessible agents.

#### Returns

`Promise`\<[`Agent`](../../agent/classes/Agent.md)[]\>
