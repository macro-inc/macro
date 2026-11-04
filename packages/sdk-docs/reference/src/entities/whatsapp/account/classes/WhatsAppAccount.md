# Class: WhatsAppAccount

The current user's WhatsApp account, connected through the Macro app.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`WhatsAppAccount`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppAccount.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-identity"></a> `identity` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Verified remote identity, absent until pairing succeeds. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The Macro user who owns this account. | - |
| <a id="property-state"></a> `state` | `readonly` | () => `Promise`\<[`WhatsAppAccountState`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppAccountState.md)\> | Account connection state; call refresh before polling it again. | - |

## Methods

### refresh()

> **refresh**(): `Promise`\<`WhatsAppAccount`\>

Discard cached connection state and load its current value.

#### Returns

`Promise`\<`WhatsAppAccount`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`WhatsAppAccount`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppAccount.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`WhatsAppAccount`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppAccount.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`WhatsAppAccount`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppAccount.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `WhatsAppAccount`

Reference an account; reads still enforce the authenticated owner's scope.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`WhatsAppAccount`

***

### from()

> `static` **from**(`client`, `record`): `WhatsAppAccount`

Seed an account handle from an API record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`WhatsAppAccount`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppAccount.md) |

#### Returns

`WhatsAppAccount`
