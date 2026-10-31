# Class: Harness

A registered host for coding agents.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Harness`](../../../../../generated/storage/types.gen/type-aliases/Harness.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-connected"></a> `connected` | `readonly` | () => `Promise`\<`boolean`\> | Whether the host is connected. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<`string`\> | Runtime kind. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Display name. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Remove the host.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Harness`](../../../../../generated/storage/types.gen/type-aliases/Harness.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Harness`](../../../../../generated/storage/types.gen/type-aliases/Harness.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Harness`](../../../../../generated/storage/types.gen/type-aliases/Harness.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `Harness`

Construct a lazy host handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Harness`

***

### from()

> `static` **from**(`client`, `record`): `Harness`

Seed from a listed host.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`Harness`](../../../../../generated/storage/types.gen/type-aliases/Harness.md) |

#### Returns

`Harness`
