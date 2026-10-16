# Class: PropertiesNamespace

Property definitions and tag sets. Entity-level reads and writes live on
the entity handles ([PropertiedEntity.properties](../../../entity/classes/PropertiedEntity.md#properties), `setProperty`,
`deleteProperty`).

## Constructors

### Constructor

> **new PropertiesNamespace**(`client`): `PropertiesNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`PropertiesNamespace`

## Methods

### addEntityPropertyOption()

> **addEntityPropertyOption**(`opts`): `Promise`\<`void`\>

Add a select option to a multi-select property value on an entity.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `entity`: [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`unknown`\>; `option`: [`PropertyOption`](../../property-option/classes/PropertyOption.md); `property`: [`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md); \} |
| `opts.entity` | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`unknown`\> |
| `opts.option` | [`PropertyOption`](../../property-option/classes/PropertyOption.md) |
| `opts.property` | [`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md) |

#### Returns

`Promise`\<`void`\>

***

### bulkEntityProperties()

> **bulkEntityProperties**(`request`): `Promise`\<`Record`\<`string`, [`EntityPropertiesResponse`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertiesResponse.md)\>\>

Get properties for multiple entities in a single request.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`BulkEntityPropertiesRequest`](../../../../../generated/properties/types.gen/type-aliases/BulkEntityPropertiesRequest.md) |

#### Returns

`Promise`\<`Record`\<`string`, [`EntityPropertiesResponse`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertiesResponse.md)\>\>

***

### create()

> **create**(`opts`): `Promise`\<[`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md)\>

Create a new custom property definition.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `dataType`: [`PropertyDataType`](../../../../../generated/properties/types.gen/type-aliases/PropertyDataType.md); `displayName`: `string`; `scope`: [`CreatePropertyScope`](../../../../../generated/properties/types.gen/type-aliases/CreatePropertyScope.md); \} |
| `opts.dataType` | [`PropertyDataType`](../../../../../generated/properties/types.gen/type-aliases/PropertyDataType.md) |
| `opts.displayName` | `string` |
| `opts.scope` | [`CreatePropertyScope`](../../../../../generated/properties/types.gen/type-aliases/CreatePropertyScope.md) |

#### Returns

`Promise`\<[`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md)\>

***

### definition()

> **definition**(`id`): [`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md)

A handle to an existing property definition by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md)

***

### list()

> **list**(`opts?`): `Promise`\<[`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md)[]\>

List property definitions visible to the user, pre-hydrated with their records.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `forEntityType?`: [`PropertyTargetEntityType`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetEntityType.md); `scope?`: [`PropertyScope`](../../../../../generated/properties/types.gen/type-aliases/PropertyScope.md); \} |
| `opts.forEntityType?` | [`PropertyTargetEntityType`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetEntityType.md) |
| `opts.scope?` | [`PropertyScope`](../../../../../generated/properties/types.gen/type-aliases/PropertyScope.md) |

#### Returns

`Promise`\<[`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md)[]\>

***

### removeEntityPropertyOption()

> **removeEntityPropertyOption**(`opts`): `Promise`\<`void`\>

Remove a select option from a multi-select property value on an entity.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `entity`: [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`unknown`\>; `option`: [`PropertyOption`](../../property-option/classes/PropertyOption.md); `property`: [`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md); \} |
| `opts.entity` | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`unknown`\> |
| `opts.option` | [`PropertyOption`](../../property-option/classes/PropertyOption.md) |
| `opts.property` | [`PropertyDefinition`](../../property-definition/classes/PropertyDefinition.md) |

#### Returns

`Promise`\<`void`\>

***

### tags()

> **tags**(): `Promise`\<[`TagSetResponse`](../../../../../generated/properties/types.gen/type-aliases/TagSetResponse.md)[]\>

The user's tag sets: their personal set, plus their team's when on a team.

#### Returns

`Promise`\<[`TagSetResponse`](../../../../../generated/properties/types.gen/type-aliases/TagSetResponse.md)[]\>

***

### updateEntityPropertyOptions()

> **updateEntityPropertyOptions**(`entities`, `change`): `Promise`\<[`BulkEntityOptionUpdateResult`](../../../../../generated/properties/types.gen/type-aliases/BulkEntityOptionUpdateResult.md)[]\>

Apply one multi-select option delta to several entity handles.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entities` | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`unknown`\>[] |
| `change` | [`PropertyOptionDelta`](../../../entity/interfaces/PropertyOptionDelta.md) |

#### Returns

`Promise`\<[`BulkEntityOptionUpdateResult`](../../../../../generated/properties/types.gen/type-aliases/BulkEntityOptionUpdateResult.md)[]\>
