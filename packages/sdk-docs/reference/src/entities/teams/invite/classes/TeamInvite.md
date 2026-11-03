# Class: TeamInvite

A pending invite to the caller's current team. Reading and revoking invites
requires a team admin or owner; `Team.invite` sends new ones.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`TeamInviteDetails`](../../../../../generated/auth/types.gen/type-aliases/TeamInviteDetails.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the invite was created, as an ISO 8601 timestamp. | - |
| <a id="property-email"></a> `email` | `readonly` | () => `Promise`\<`string`\> | The invited email address. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-invitedby"></a> `invitedBy` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The member who sent the invite. | - |
| <a id="property-lastsentat"></a> `lastSentAt` | `readonly` | () => `Promise`\<`string`\> | When the invite email was last sent, as an ISO 8601 timestamp. | - |
| <a id="property-role"></a> `role` | `readonly` | () => `Promise`\<[`TeamRole`](../../../../../generated/auth/types.gen/type-aliases/TeamRole.md)\> | The role the invitee gets when they join. | - |

## Methods

### revoke()

> **revoke**(): `Promise`\<`void`\>

Revoke this invite so it can no longer be accepted; only a team admin or
owner may revoke.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`TeamInviteDetails`](../../../../../generated/auth/types.gen/type-aliases/TeamInviteDetails.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`TeamInviteDetails`](../../../../../generated/auth/types.gen/type-aliases/TeamInviteDetails.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`TeamInviteDetails`](../../../../../generated/auth/types.gen/type-aliases/TeamInviteDetails.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `TeamInvite`

A handle to a pending team invite by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`TeamInvite`

***

### from()

> `static` **from**(`client`, `record`): `TeamInvite`

Build an invite from an already-fetched record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`TeamInviteDetails`](../../../../../generated/auth/types.gen/type-aliases/TeamInviteDetails.md) |

#### Returns

`TeamInvite`
