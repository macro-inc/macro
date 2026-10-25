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

***

### search()

> **search**(`query`): `Promise`\<[`User`](../../user/classes/User.md)[]\>

Find people in your existing Macro contacts by name or email, as in the
mention picker. This is not a global directory. Returns every matching
contact so callers can disambiguate; it never chooses a person for you.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |

#### Returns

`Promise`\<[`User`](../../user/classes/User.md)[]\>
