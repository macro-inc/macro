# Abstract Class: PropertiedEntity\<Detail\>

A favoritable entity that also carries user-defined properties.

## Extends

- [`FavoritableEntity`](FavoritableEntity.md)\<`Detail`\>

## Extended by

- [`Channel`](../../channels/channel/classes/Channel.md)
- [`Chat`](../../chats/chat/classes/Chat.md)
- [`Company`](../../crm/company/classes/Company.md)
- [`Document`](../../documents/document/classes/Document.md)
- [`EmailThread`](../../email/thread/classes/EmailThread.md)
- [`Project`](../../projects/project/classes/Project.md)
- [`User`](../../users/user/classes/User.md)

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-detail"></a> `Detail` |

## Implements

- [`Propertied`](../interfaces/Propertied.md)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-entitytype"></a> `entityType` | `abstract readonly` | `"project"` \| `"user"` \| `"team"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"email_thread"` \| `"calendar_event"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | How the entity-addressed APIs (favorites) identify this entity's type. | [`FavoritableEntity`](FavoritableEntity.md).[`entityType`](FavoritableEntity.md#property-entitytype) |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`FavoritableEntity`](FavoritableEntity.md).[`id`](FavoritableEntity.md#property-id) |

## Methods

### deleteProperty()

> **deleteProperty**(`assignment`): `Promise`\<`void`\>

Remove a property from this entity, given its [properties](#properties) entry.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `assignment` | [`EntityPropertyWithDefinition`](../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md) |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`Propertied`](../interfaces/Propertied.md).[`deleteProperty`](../interfaces/Propertied.md#deleteproperty)

***

### favorite()

> **favorite**(): `Promise`\<`PropertiedEntity`\<`Detail`\>\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`PropertiedEntity`\<`Detail`\>\>

#### Implementation of

[`Propertied`](../interfaces/Propertied.md).[`favorite`](../interfaces/Propertied.md#favorite)

#### Inherited from

[`FavoritableEntity`](FavoritableEntity.md).[`favorite`](FavoritableEntity.md#favorite)

***

### properties()

> **properties**(`opts?`): `Promise`\<[`EntityPropertyWithDefinition`](../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

The properties set on this entity, each with its definition, value, and options.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `includeMetadata?`: `boolean`; \} |
| `opts.includeMetadata?` | `boolean` |

#### Returns

`Promise`\<[`EntityPropertyWithDefinition`](../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

#### Implementation of

[`Propertied`](../interfaces/Propertied.md).[`properties`](../interfaces/Propertied.md#properties)

***

### propertyReference()

> **propertyReference**(): [`PropertyTargetReference`](../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

This entity's reference for bulk property operations.

#### Returns

[`PropertyTargetReference`](../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

***

### setProperty()

> **setProperty**(`property`, `value?`): `Promise`\<`void`\>

Set a property value on this entity, or attach the property without a
value when `value` is omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `property` | [`PropertyDefinition`](../../properties/property-definition/classes/PropertyDefinition.md) |
| `value?` | [`SetPropertyValue`](../../../../generated/properties/types.gen/type-aliases/SetPropertyValue.md) |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`Propertied`](../interfaces/Propertied.md).[`setProperty`](../interfaces/Propertied.md#setproperty)

***

### toJSON()

> **toJSON**(): \{ `detail?`: `Detail`; `id`: `string`; \}

#### Returns

\{ `detail?`: `Detail`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | `Detail` |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](FavoritableEntity.md).[`toJSON`](FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`PropertiedEntity`\<`Detail`\>\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`PropertiedEntity`\<`Detail`\>\>

#### Implementation of

[`Propertied`](../interfaces/Propertied.md).[`unfavorite`](../interfaces/Propertied.md#unfavorite)

#### Inherited from

[`FavoritableEntity`](FavoritableEntity.md).[`unfavorite`](FavoritableEntity.md#unfavorite)

***

### updatePropertyOptions()

> **updatePropertyOptions**(`changes`): `Promise`\<[`BulkUpdateEntityPropertyOptionsResponse`](../../../../generated/properties/types.gen/type-aliases/BulkUpdateEntityPropertyOptionsResponse.md)\>

Apply multi-select option deltas atomically across this entity's properties.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `changes` | [`PropertyOptionDelta`](../interfaces/PropertyOptionDelta.md)[] |

#### Returns

`Promise`\<[`BulkUpdateEntityPropertyOptionsResponse`](../../../../generated/properties/types.gen/type-aliases/BulkUpdateEntityPropertyOptionsResponse.md)\>
