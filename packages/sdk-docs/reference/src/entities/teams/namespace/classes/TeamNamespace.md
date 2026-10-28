# Class: TeamNamespace

## Constructors

### Constructor

> **new TeamNamespace**(`client`): `TeamNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`TeamNamespace`

## Methods

### byId()

> **byId**(`id`): [`Team`](../../team/classes/Team.md)

A handle to a team by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Team`](../../team/classes/Team.md)

***

### current()

> **current**(): `Promise`\<[`Team`](../../team/classes/Team.md)\>

The caller's current team.

#### Returns

`Promise`\<[`Team`](../../team/classes/Team.md)\>

***

### list()

> **list**(): `Promise`\<[`Team`](../../team/classes/Team.md)[]\>

The teams the caller belongs to.

#### Returns

`Promise`\<[`Team`](../../team/classes/Team.md)[]\>
