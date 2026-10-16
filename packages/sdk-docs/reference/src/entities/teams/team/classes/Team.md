# Class: Team

A Macro team. A free-to-construct handle; the record loads lazily on first
field access, resolved from the caller's team memberships.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Team`](../../../../../generated/auth/types.gen/type-aliases/Team.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-defaultlinkshare"></a> `defaultLinkShare` | `readonly` | () => `Promise`\<`NonNullable`\<LinkShare \| null \| undefined\> \| `undefined`\> | The team's default link-share scope for newly shared items, or null when link sharing is off by default. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The team's display name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The user who owns the team. | - |
| <a id="property-slug"></a> `slug` | `readonly` | () => `Promise`\<`string`\> | The team's slug (its URL identifier). | - |

## Methods

### members()

> **members**(): `Promise`\<[`TeamMembership`](../interfaces/TeamMembership.md)[]\>

The team's members, with their roles. The API only exposes members for
the caller's current team, so this rejects for any other team.

#### Returns

`Promise`\<[`TeamMembership`](../interfaces/TeamMembership.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Team`](../../../../../generated/auth/types.gen/type-aliases/Team.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Team`](../../../../../generated/auth/types.gen/type-aliases/Team.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Team`](../../../../../generated/auth/types.gen/type-aliases/Team.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `Team`

A handle to a team by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Team`

***

### current()

> `static` **current**(`client`): `Promise`\<`Team`\>

The caller's current team.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Team`\>

***

### list()

> `static` **list**(`client`): `Promise`\<`Team`[]\>

The teams the caller belongs to.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Team`[]\>
