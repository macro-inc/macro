# Class: HarnessPairing

A short lived host pairing, addressed by its displayed code.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`PairingDetails`](../../../../../generated/storage/types.gen/type-aliases/PairingDetails.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-expiresat"></a> `expiresAt` | `readonly` | () => `Promise`\<`string`\> | Expiration time. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Requested name. | - |

## Methods

### approve()

> **approve**(`options?`): `Promise`\<[`Harness`](../../harness/classes/Harness.md)\>

Approve this pairing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `allowPermissionBypass?`: `boolean`; `name?`: `string`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `options.allowPermissionBypass?` | `boolean` |
| `options.name?` | `string` |
| `options.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<[`Harness`](../../harness/classes/Harness.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`PairingDetails`](../../../../../generated/storage/types.gen/type-aliases/PairingDetails.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`PairingDetails`](../../../../../generated/storage/types.gen/type-aliases/PairingDetails.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`PairingDetails`](../../../../../generated/storage/types.gen/type-aliases/PairingDetails.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `code`): `HarnessPairing`

Construct a lazy pairing from a pairing code.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `code` | `string` |

#### Returns

`HarnessPairing`
