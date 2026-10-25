# Class: AccessRequest

One access request; resolutions preserve optimistic concurrency.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | [`EntityAccess`](EntityAccess.md) | Entity access surface owning the request. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-requestedlevel"></a> `requestedLevel` | `readonly` | () => `Promise`\<[`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md)\> | Requested access. | - |
| <a id="property-requester"></a> `requester` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | Requesting user. | - |
| <a id="property-revision"></a> `revision` | `readonly` | () => `Promise`\<`number`\> | Request revision. | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`RequestStatus`](../../../../../generated/storage/types.gen/type-aliases/RequestStatus.md)\> | Current request state. | - |

## Methods

### resolve()

> **resolve**(`grantedLevel?`): `Promise`\<`void`\>

Approve with an access level, or decline by omitting it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `grantedLevel?` | [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md) |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### from()

> `static` **from**(`client`, `access`, `record`): `AccessRequest`

Seed a request from a state or submission response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `access` | [`EntityAccess`](EntityAccess.md) |
| `record` | [`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md) |

#### Returns

`AccessRequest`
