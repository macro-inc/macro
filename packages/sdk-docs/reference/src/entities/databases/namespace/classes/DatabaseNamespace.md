# Class: DatabaseNamespace

Macro databases: named collections of tables, owned and shared as one
entity.

## Constructors

### Constructor

> **new DatabaseNamespace**(`client`): `DatabaseNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`DatabaseNamespace`

## Methods

### byId()

> **byId**(`id`): [`Database`](../../database/classes/Database.md)

A handle to a database by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Database`](../../database/classes/Database.md)

***

### create()

> **create**(`options`): `Promise`\<[`Database`](../../database/classes/Database.md)\>

Create a database owned by the caller.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `name`: `string`; \} |
| `options.name` | `string` |

#### Returns

`Promise`\<[`Database`](../../database/classes/Database.md)\>

***

### list()

> **list**(): `Promise`\<[`Database`](../../database/classes/Database.md)[]\>

The databases the caller can see.

#### Returns

`Promise`\<[`Database`](../../database/classes/Database.md)[]\>
