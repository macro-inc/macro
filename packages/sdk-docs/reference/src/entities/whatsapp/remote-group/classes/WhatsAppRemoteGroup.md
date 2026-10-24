# Class: WhatsAppRemoteGroup

An existing group joined by the current user's connected WhatsApp account.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`LinkedGroupInfo`](../../../../../generated/storage/types.gen/type-aliases/LinkedGroupInfo.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-announce"></a> `announce` | `readonly` | () => `Promise`\<`boolean`\> | Whether only remote administrators can post. | - |
| <a id="property-community"></a> `community` | `readonly` | () => `Promise`\<`boolean`\> | Whether this group is an unsupported community parent or announcement group. | - |
| <a id="property-disappearing"></a> `disappearing` | `readonly` | () => `Promise`\<`boolean`\> | Whether disappearing messages prevent retention of group content. | - |
| <a id="property-group"></a> `group` | `readonly` | () => `Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) \| `undefined`\> | Adopted entity, when this remote group has been added to Macro. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Current remote group subject. | - |
| <a id="property-observedat"></a> `observedAt` | `readonly` | () => `Promise`\<`string`\> | When the session service last observed this metadata. | - |
| <a id="property-participants"></a> `participants` | `readonly` | () => `Promise`\<[`LinkedParticipant`](../../../../../generated/storage/types.gen/type-aliases/LinkedParticipant.md)[]\> | Current remote roster; membership alone does not grant Macro history access. | - |

## Methods

### adopt()

> **adopt**(`options?`): `Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)\>

Adopt with a name; share through the normal entity sharing endpoints.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `name?`: `string`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `options.name?` | `string` |
| `options.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)\>

***

### refresh()

> **refresh**(): `Promise`\<`WhatsAppRemoteGroup`\>

Reload the group's roster and adoption state.

#### Returns

`Promise`\<`WhatsAppRemoteGroup`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`LinkedGroupInfo`](../../../../../generated/storage/types.gen/type-aliases/LinkedGroupInfo.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`LinkedGroupInfo`](../../../../../generated/storage/types.gen/type-aliases/LinkedGroupInfo.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`LinkedGroupInfo`](../../../../../generated/storage/types.gen/type-aliases/LinkedGroupInfo.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `WhatsAppRemoteGroup`

Reference a remote group by its verified JID.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`WhatsAppRemoteGroup`

***

### from()

> `static` **from**(`client`, `record`): `WhatsAppRemoteGroup`

Seed a group handle from the current account's roster.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`LinkedGroupInfo`](../../../../../generated/storage/types.gen/type-aliases/LinkedGroupInfo.md) |

#### Returns

`WhatsAppRemoteGroup`
