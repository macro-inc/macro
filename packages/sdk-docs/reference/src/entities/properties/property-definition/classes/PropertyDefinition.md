# Class: PropertyDefinition

A property definition: schema for a custom field that can be attached to
entities. Obtain instances via PropertiesNamespace.create,
PropertiesNamespace.list, or PropertiesNamespace.definition.

## Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` |

## Accessors

### createdAt

#### Get Signature

> **get** **createdAt**(): `Promise`\<`string`\>

##### Returns

`Promise`\<`string`\>

***

### dataType

#### Get Signature

> **get** **dataType**(): `Promise`\<[`DataType`](../../../../../generated/properties/types.gen/type-aliases/DataType.md)\>

##### Returns

`Promise`\<[`DataType`](../../../../../generated/properties/types.gen/type-aliases/DataType.md)\>

***

### displayName

#### Get Signature

> **get** **displayName**(): `Promise`\<`string`\>

##### Returns

`Promise`\<`string`\>

***

### isMultiSelect

#### Get Signature

> **get** **isMultiSelect**(): `Promise`\<`boolean`\>

##### Returns

`Promise`\<`boolean`\>

***

### isSystem

#### Get Signature

> **get** **isSystem**(): `Promise`\<`boolean`\>

##### Returns

`Promise`\<`boolean`\>

***

### owner

#### Get Signature

> **get** **owner**(): `Promise`\<[`PropertyOwner`](../../../../../generated/properties/types.gen/type-aliases/PropertyOwner.md)\>

##### Returns

`Promise`\<[`PropertyOwner`](../../../../../generated/properties/types.gen/type-aliases/PropertyOwner.md)\>

***

### updatedAt

#### Get Signature

> **get** **updatedAt**(): `Promise`\<`string`\>

##### Returns

`Promise`\<`string`\>

## Methods

### addOption()

> **addOption**(`option`): `Promise`\<[`PropertyOption`](../../property-option/classes/PropertyOption.md)\>

Add an option to this select-type property.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`AddPropertyOptionRequest`](../../../../../generated/properties/types.gen/type-aliases/AddPropertyOptionRequest.md) |

#### Returns

`Promise`\<[`PropertyOption`](../../property-option/classes/PropertyOption.md)\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this property definition.

#### Returns

`Promise`\<`void`\>

***

### deleteOption()

> **deleteOption**(`option`): `Promise`\<`void`\>

Delete an option from this property.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PropertyOption`](../../property-option/classes/PropertyOption.md) |

#### Returns

`Promise`\<`void`\>

***

### options()

> **options**(): `Promise`\<[`PropertyOption`](../../property-option/classes/PropertyOption.md)[]\>

The selectable options for this definition (select-type properties).

#### Returns

`Promise`\<[`PropertyOption`](../../property-option/classes/PropertyOption.md)[]\>

***

### updateOption()

> **updateOption**(`option`, `updates`): `Promise`\<[`PropertyOption`](../../property-option/classes/PropertyOption.md)\>

Update an option (label, color, display order).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PropertyOption`](../../property-option/classes/PropertyOption.md) |
| `updates` | [`UpdatePropertyOptionRequest`](../../../../../generated/properties/types.gen/type-aliases/UpdatePropertyOptionRequest.md) |

#### Returns

`Promise`\<[`PropertyOption`](../../property-option/classes/PropertyOption.md)\>

***

### byId()

> `static` **byId**(`client`, `id`): `PropertyDefinition`

A handle to an existing definition by id. Fields load lazily on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`PropertyDefinition`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`PropertyDefinition`\>

Create a new property definition.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `dataType`: [`PropertyDataType`](../../../../../generated/properties/types.gen/type-aliases/PropertyDataType.md); `displayName`: `string`; `scope`: [`CreatePropertyScope`](../../../../../generated/properties/types.gen/type-aliases/CreatePropertyScope.md); \} |
| `opts.dataType` | [`PropertyDataType`](../../../../../generated/properties/types.gen/type-aliases/PropertyDataType.md) |
| `opts.displayName` | `string` |
| `opts.scope` | [`CreatePropertyScope`](../../../../../generated/properties/types.gen/type-aliases/CreatePropertyScope.md) |

#### Returns

`Promise`\<`PropertyDefinition`\>

***

### fromRecord()

> `static` **fromRecord**(`client`, `record`): `PropertyDefinition`

Wrap a record already in hand (e.g. from a list response).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`PropertyDefinition`](../../../../../generated/properties/types.gen/type-aliases/PropertyDefinition.md) |

#### Returns

`PropertyDefinition`
