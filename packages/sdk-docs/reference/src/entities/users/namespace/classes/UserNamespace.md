# Class: UserNamespace

## Constructors

### Constructor

> **new UserNamespace**(`client`): `UserNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`UserNamespace`

## Methods

### byId()

> **byId**(`id`): [`User`](../../user/classes/User.md)

A handle to a user by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`User`](../../user/classes/User.md)

***

### me()

> **me**(): `Promise`\<[`User`](../../user/classes/User.md)\>

The current authenticated user.

#### Returns

`Promise`\<[`User`](../../user/classes/User.md)\>
