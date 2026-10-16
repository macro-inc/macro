# Class: FormNamespace

Forms collect answers into a database table without granting respondents table access.

## Constructors

### Constructor

> **new FormNamespace**(`client`): `FormNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`FormNamespace`

## Methods

### byId()

> **byId**(`id`): [`Form`](../../form/classes/Form.md)

A form handle. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Form`](../../form/classes/Form.md)

***

### create()

> **create**(`options`): `Promise`\<[`Form`](../../form/classes/Form.md)\>

Create a form over an existing table, or create its own Responses database.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `name`: `string`; `table?`: [`DatabaseTable`](../../../databases/table/classes/DatabaseTable.md); \} |
| `options.name` | `string` |
| `options.table?` | [`DatabaseTable`](../../../databases/table/classes/DatabaseTable.md) |

#### Returns

`Promise`\<[`Form`](../../form/classes/Form.md)\>

***

### list()

> **list**(`database?`): `Promise`\<[`Form`](../../form/classes/Form.md)[]\>

List forms shared with the caller, or forms over a database the caller can read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `database?` | [`Database`](../../../databases/database/classes/Database.md) |

#### Returns

`Promise`\<[`Form`](../../form/classes/Form.md)[]\>
