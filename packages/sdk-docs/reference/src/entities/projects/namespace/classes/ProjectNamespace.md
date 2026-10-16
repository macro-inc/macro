# Class: ProjectNamespace

## Constructors

### Constructor

> **new ProjectNamespace**(`client`): `ProjectNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ProjectNamespace`

## Methods

### byId()

> **byId**(`id`): [`Project`](../../project/classes/Project.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Project`](../../project/classes/Project.md)

***

### create()

> **create**(`opts`): `Promise`\<[`Project`](../../project/classes/Project.md)\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `name`: `string`; `parent?`: [`Project`](../../project/classes/Project.md); \} |
| `opts.name` | `string` |
| `opts.parent?` | [`Project`](../../project/classes/Project.md) |

#### Returns

`Promise`\<[`Project`](../../project/classes/Project.md)\>

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`Project`](../../project/classes/Project.md)\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`Project`](../../project/classes/Project.md)\>
