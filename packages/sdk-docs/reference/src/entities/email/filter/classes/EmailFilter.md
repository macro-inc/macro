# Class: EmailFilter

An importance filter matched by sender address or domain.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ApiEmailFilter`](../../../../../generated/email/types.gen/type-aliases/ApiEmailFilter.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-emailaddress"></a> `emailAddress` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Matched address. | - |
| <a id="property-emaildomain"></a> `emailDomain` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Matched domain. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-isimportant"></a> `isImportant` | `readonly` | () => `Promise`\<`boolean`\> | Importance assigned by this filter. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this filter.

#### Returns

`Promise`\<`void`\>

***

### setImportant()

> **setImportant**(`isImportant`): `Promise`\<`void`\>

Change the importance for the same sender selector.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `isImportant` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ApiEmailFilter`](../../../../../generated/email/types.gen/type-aliases/ApiEmailFilter.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ApiEmailFilter`](../../../../../generated/email/types.gen/type-aliases/ApiEmailFilter.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ApiEmailFilter`](../../../../../generated/email/types.gen/type-aliases/ApiEmailFilter.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`, `inbox?`): `EmailFilter`

Construct a lazy filter handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |
| `inbox?` | [`Link`](../../link/classes/Link.md) |

#### Returns

`EmailFilter`

***

### from()

> `static` **from**(`client`, `record`, `inbox?`): `EmailFilter`

Seed from a server record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`ApiEmailFilter`](../../../../../generated/email/types.gen/type-aliases/ApiEmailFilter.md) |
| `inbox?` | [`Link`](../../link/classes/Link.md) |

#### Returns

`EmailFilter`
