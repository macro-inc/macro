# Class: Label

An email label. A free-to-construct handle: there is no single-label GET,
so the detail record loads lazily on first field access by listing all
labels and finding this one (mirroring Link).

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ApiLabel`](../../../../../generated/email/types.gen/type-aliases/ApiLabel.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the label was created. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-labellistvisibility"></a> `labelListVisibility` | `readonly` | () => `Promise`\<[`ApiLabelListVisibility`](../../../../../generated/email/types.gen/type-aliases/ApiLabelListVisibility.md)\> | Whether the label is shown in the label list. | - |
| <a id="property-linkid"></a> `linkId` | `readonly` | () => `Promise`\<`string`\> | The inbox (email link) this label belongs to. | - |
| <a id="property-messagelistvisibility"></a> `messageListVisibility` | `readonly` | () => `Promise`\<[`ApiMessageListVisibility`](../../../../../generated/email/types.gen/type-aliases/ApiMessageListVisibility.md)\> | Whether the label is shown in the message list. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The label's display name. | - |
| <a id="property-type"></a> `type` | `readonly` | () => `Promise`\<[`ApiLabelType`](../../../../../generated/email/types.gen/type-aliases/ApiLabelType.md)\> | Whether this is a system label or a user-created one. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this label.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ApiLabel`](../../../../../generated/email/types.gen/type-aliases/ApiLabel.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ApiLabel`](../../../../../generated/email/types.gen/type-aliases/ApiLabel.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ApiLabel`](../../../../../generated/email/types.gen/type-aliases/ApiLabel.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `Label`

A handle to a label by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Label`

***

### create()

> `static` **create**(`client`, `name`): `Promise`\<`Label`\>

Create a user label.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `name` | `string` |

#### Returns

`Promise`\<`Label`\>

***

### list()

> `static` **list**(`client`): `Promise`\<`Label`[]\>

All labels across the user's inboxes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Label`[]\>
