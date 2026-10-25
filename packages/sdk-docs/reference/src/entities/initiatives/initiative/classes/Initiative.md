# Class: Initiative

A group of tasks and members working toward an outcome.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`InitiativeDetail`](../../../../../generated/storage/types.gen/type-aliases/InitiativeDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | [`EntityAccess`](../../../sharing/access/classes/EntityAccess.md) | Access requests and direct user grants. | - |
| <a id="property-accesslevel"></a> `accessLevel` | `readonly` | () => `Promise`\<[`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md)\> | Current user's access. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-members"></a> `members` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)[]\> | Assigned members. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Display name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | Owner. | - |
| <a id="property-sharepermissions"></a> `sharePermissions` | `readonly` | () => `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\> | Sharing configuration. | - |
| <a id="property-tasks"></a> `tasks` | `readonly` | () => `Promise`\<[`Task`](../../../tasks/task/classes/Task.md)[]\> | Tasks in this initiative. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this initiative.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`InitiativeDetail`](../../../../../generated/storage/types.gen/type-aliases/InitiativeDetail.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`InitiativeDetail`](../../../../../generated/storage/types.gen/type-aliases/InitiativeDetail.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`InitiativeDetail`](../../../../../generated/storage/types.gen/type-aliases/InitiativeDetail.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Update the name, membership or sharing configuration.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `members?`: [`User`](../../../users/user/classes/User.md)[]; `name?`: `string`; `sharePermission?`: [`SharePermissionOptions`](../../../sharing/permissions/type-aliases/SharePermissionOptions.md); \} |
| `options.members?` | [`User`](../../../users/user/classes/User.md)[] |
| `options.name?` | `string` |
| `options.sharePermission?` | [`SharePermissionOptions`](../../../sharing/permissions/type-aliases/SharePermissionOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `Initiative`

Construct a lazy initiative handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Initiative`

***

### from()

> `static` **from**(`client`, `record`): `Initiative`

Seed from an initiative detail response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`InitiativeDetail`](../../../../../generated/storage/types.gen/type-aliases/InitiativeDetail.md) |

#### Returns

`Initiative`
