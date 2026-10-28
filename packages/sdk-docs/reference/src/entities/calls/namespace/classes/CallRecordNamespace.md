# Class: CallRecordNamespace

## Constructors

### Constructor

> **new CallRecordNamespace**(`client`): `CallRecordNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`CallRecordNamespace`

## Methods

### byId()

> **byId**(`id`): [`CallRecord`](../../call-record/classes/CallRecord.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CallRecord`](../../call-record/classes/CallRecord.md)

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`CallRecord`](../../call-record/classes/CallRecord.md)\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`CallRecord`](../../call-record/classes/CallRecord.md)\>
