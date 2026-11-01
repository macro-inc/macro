# Class: PropertyOption

A selectable option on a select-type property definition. There is no
single-option GET, so instances are only built from a seed record — via
PropertyDefinition.options or PropertyDefinition.addOption.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-definitionid"></a> `definitionId` | `readonly` | `string` | The property definition this option belongs to. |
| <a id="property-id"></a> `id` | `readonly` | `string` | - |

## Accessors

### color

#### Get Signature

> **get** **color**(): `string` \| `undefined`

The option's display color, if set.

##### Returns

`string` \| `undefined`

***

### createdAt

#### Get Signature

> **get** **createdAt**(): `string`

When the option was created.

##### Returns

`string`

***

### displayOrder

#### Get Signature

> **get** **displayOrder**(): `number`

The option's position among its definition's options.

##### Returns

`number`

***

### updatedAt

#### Get Signature

> **get** **updatedAt**(): `string`

When the option was last updated.

##### Returns

`string`

***

### value

#### Get Signature

> **get** **value**(): [`PropertyOptionValue`](../../../../../generated/properties/types.gen/type-aliases/PropertyOptionValue.md)

The option's value (string or number, per the property's data type).

##### Returns

[`PropertyOptionValue`](../../../../../generated/properties/types.gen/type-aliases/PropertyOptionValue.md)

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this option from its property definition.

#### Returns

`Promise`\<`void`\>

***

### update()

> **update**(`updates`): `Promise`\<`PropertyOption`\>

Update this option's label, color, or display order.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `updates` | [`UpdatePropertyOptionRequest`](../../../../../generated/properties/types.gen/type-aliases/UpdatePropertyOptionRequest.md) |

#### Returns

`Promise`\<`PropertyOption`\>

***

### from()

> `static` **from**(`client`, `definitionId`, `record`): `PropertyOption`

Wrap a record already in hand (e.g. from a list or create response).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `definitionId` | `string` |
| `record` | [`PropertyOption`](../../../../../generated/properties/types.gen/type-aliases/PropertyOption.md) |

#### Returns

`PropertyOption`
