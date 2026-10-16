# Class: ChatNamespace

## Constructors

### Constructor

> **new ChatNamespace**(`client`): `ChatNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ChatNamespace`

## Methods

### byId()

> **byId**(`id`): [`Chat`](../../chat/classes/Chat.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Chat`](../../chat/classes/Chat.md)

***

### create()

> **create**(`opts?`): `Promise`\<[`Chat`](../../chat/classes/Chat.md)\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `name?`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.name?` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<[`Chat`](../../chat/classes/Chat.md)\>

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`Chat`](../../chat/classes/Chat.md)\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`Chat`](../../chat/classes/Chat.md)\>
