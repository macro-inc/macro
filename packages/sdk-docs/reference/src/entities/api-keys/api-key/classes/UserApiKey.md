# Class: UserApiKey

A user API key's metadata. Secrets are returned only at creation.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`UserApiKeyInfo`](../../../../../generated/storage/types.gen/type-aliases/UserApiKeyInfo.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | Creation time. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Human readable label. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Revoke this key.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`UserApiKeyInfo`](../../../../../generated/storage/types.gen/type-aliases/UserApiKeyInfo.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`UserApiKeyInfo`](../../../../../generated/storage/types.gen/type-aliases/UserApiKeyInfo.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`UserApiKeyInfo`](../../../../../generated/storage/types.gen/type-aliases/UserApiKeyInfo.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `UserApiKey`

Construct a lazy key handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`UserApiKey`

***

### from()

> `static` **from**(`client`, `record`): `UserApiKey`

Seed from metadata, deliberately excluding the secret.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`UserApiKeyInfo`](../../../../../generated/storage/types.gen/type-aliases/UserApiKeyInfo.md) |

#### Returns

`UserApiKey`
