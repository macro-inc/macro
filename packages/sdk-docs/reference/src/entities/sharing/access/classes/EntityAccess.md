# Class: EntityAccess

Access requests and direct grants scoped to a shareable entity.

## Constructors

### Constructor

> **new EntityAccess**(`client`, `entityType`, `entity`): `EntityAccess`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `entityType` | [`ShareEntityType`](../../../../../generated/storage/types.gen/type-aliases/ShareEntityType.md) |
| `entity` | \{ `id`: `string`; \} |
| `entity.id` | `string` |

#### Returns

`EntityAccess`

## Methods

### cancel()

> **cancel**(`revision`): `Promise`\<`void`\>

Cancel the caller's own request at its observed revision.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `revision` | `number` |

#### Returns

`Promise`\<`void`\>

***

### direct()

> **direct**(): `Promise`\<\{ `accessLevel`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md); `user`: [`User`](../../../users/user/classes/User.md); \}[]\>

Direct grants expressed as user handles.

#### Returns

`Promise`\<\{ `accessLevel`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md); `user`: [`User`](../../../users/user/classes/User.md); \}[]\>

***

### grant()

> **grant**(`user`, `accessLevel?`): `Promise`\<`void`\>

Grant direct access, or remove it by omitting the access level.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `user` | [`User`](../../../users/user/classes/User.md) |
| `accessLevel?` | [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md) |

#### Returns

`Promise`\<`void`\>

***

### remove()

> **remove**(`user`): `Promise`\<`void`\>

Remove one user's direct grant.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `user` | [`User`](../../../users/user/classes/User.md) |

#### Returns

`Promise`\<`void`\>

***

### resolve()

> **resolve**(`request`, `resolution`): `Promise`\<[`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md)\>

Resolve a request belonging to this entity at an observed revision.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`AccessRequest`](AccessRequest.md) |
| `resolution` | [`ResolveRequest`](../../../../../generated/storage/types.gen/type-aliases/ResolveRequest.md) |

#### Returns

`Promise`\<[`AccessRequest`](../../../../../generated/storage/types.gen/type-aliases/AccessRequest.md)\>

***

### state()

> **state**(`offset?`): `Promise`\<\{ `accessLevel`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md) \| `undefined`; `canReview`: `boolean`; `mine`: [`AccessRequest`](AccessRequest.md) \| `undefined`; `nextOffset`: `number` \| `undefined`; `owner`: [`User`](../../../users/user/classes/User.md) \| `undefined`; `pendingCount`: `number`; `requests`: [`AccessRequest`](AccessRequest.md)[]; `supportedLevels`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md)[]; \}\>

A page of access requests, including the caller's own request and review rights.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `offset?` | `number` |

#### Returns

`Promise`\<\{ `accessLevel`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md) \| `undefined`; `canReview`: `boolean`; `mine`: [`AccessRequest`](AccessRequest.md) \| `undefined`; `nextOffset`: `number` \| `undefined`; `owner`: [`User`](../../../users/user/classes/User.md) \| `undefined`; `pendingCount`: `number`; `requests`: [`AccessRequest`](AccessRequest.md)[]; `supportedLevels`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md)[]; \}\>

***

### submit()

> **submit**(`requestedLevel`, `revision?`): `Promise`\<[`AccessRequest`](AccessRequest.md)\>

Request access, optionally naming the revision of an earlier request.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `requestedLevel` | [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md) |
| `revision?` | `number` |

#### Returns

`Promise`\<[`AccessRequest`](AccessRequest.md)\>

***

### toJSON()

> **toJSON**(): \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](../../../../../generated/storage/types.gen/type-aliases/ShareEntityType.md); \}

Serialize the entity reference without credentials.

#### Returns

\{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](../../../../../generated/storage/types.gen/type-aliases/ShareEntityType.md); \}

| Name | Type |
| ------ | ------ |
| `entity_id` | `string` |
| `entity_type` | [`ShareEntityType`](../../../../../generated/storage/types.gen/type-aliases/ShareEntityType.md) |
