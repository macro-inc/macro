# Class: User

A Macro user. Identity lives in the auth service, so details like the
display name are fetched on demand. Can be dropped into a msg
template to @-mention the user.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<[`UserName`](../../../../../generated/auth/types.gen/type-aliases/UserName.md)\>

## Implements

- [`Mentionable`](../../../../mentions/interfaces/Mentionable.md)

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"user"` | `'user'` | Favorites identify users as `user`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |

## Methods

### deleteProperty()

> **deleteProperty**(`assignment`): `Promise`\<`void`\>

Remove a property from this entity, given its [properties](#properties) entry.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `assignment` | [`EntityPropertyWithDefinition`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`deleteProperty`](../../../entity/classes/PropertiedEntity.md#deleteproperty)

***

### dm()

> **dm**(): `Promise`\<[`Channel`](../../../channels/channel/classes/Channel.md)\>

Open (or create) your direct-message channel with this user.

#### Returns

`Promise`\<[`Channel`](../../../channels/channel/classes/Channel.md)\>

The DM `Channel`.

***

### email()

> **email**(): `string` \| `undefined`

This user's email address. Macro user ids encode it as `macro|<email>`,
so this reads straight off the id — no auth-service endpoint returns
emails for arbitrary users.

#### Returns

`string` \| `undefined`

The email, or `undefined` if the id is not email-derived.

***

### favorite()

> **favorite**(): `Promise`\<`User`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`User`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### name()

> **name**(): `Promise`\<`string` \| `undefined`\>

This user's display name, fetched from the auth service (falling back to
your email contacts when the Macro profile has none).

#### Returns

`Promise`\<`string` \| `undefined`\>

The full name, or `undefined` if the user has no name on record.

***

### permission()

> **permission**(): `Promise`\<\{ `permission`: [`EntityPermission`](../../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

Read the caller's effective permission on this entity.

#### Returns

`Promise`\<\{ `permission`: [`EntityPermission`](../../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`permission`](../../../entity/classes/PropertiedEntity.md#permission)

***

### properties()

> **properties**(`opts?`): `Promise`\<[`EntityPropertyWithDefinition`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

The properties set on this entity, each with its definition, value, and options.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `includeMetadata?`: `boolean`; \} |
| `opts.includeMetadata?` | `boolean` |

#### Returns

`Promise`\<[`EntityPropertyWithDefinition`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`properties`](../../../entity/classes/PropertiedEntity.md#properties)

***

### propertyReference()

> **propertyReference**(): [`PropertyTargetReference`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

This entity's reference for bulk property operations.

#### Returns

[`PropertyTargetReference`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`propertyReference`](../../../entity/classes/PropertiedEntity.md#propertyreference)

***

### setProperty()

> **setProperty**(`property`, `value?`): `Promise`\<`void`\>

Set a property value on this entity, or attach the property without a
value when `value` is omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `property` | [`PropertyDefinition`](../../../properties/property-definition/classes/PropertyDefinition.md) |
| `value?` | [`SetPropertyValue`](../../../../../generated/properties/types.gen/type-aliases/SetPropertyValue.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`setProperty`](../../../entity/classes/PropertiedEntity.md#setproperty)

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`UserName`](../../../../../generated/auth/types.gen/type-aliases/UserName.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`UserName`](../../../../../generated/auth/types.gen/type-aliases/UserName.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`UserName`](../../../../../generated/auth/types.gen/type-aliases/UserName.md) |
| `id` | `string` |

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`toJSON`](../../../entity/classes/PropertiedEntity.md#tojson)

***

### toMention()

> **toMention**(): [`MentionPart`](../../../../mentions/interfaces/MentionPart.md)

#### Returns

[`MentionPart`](../../../../mentions/interfaces/MentionPart.md)

#### Implementation of

[`Mentionable`](../../../../mentions/interfaces/Mentionable.md).[`toMention`](../../../../mentions/interfaces/Mentionable.md#tomention)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`User`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`User`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`unfavorite`](../../../entity/classes/PropertiedEntity.md#unfavorite)

***

### updatePropertyOptions()

> **updatePropertyOptions**(`changes`): `Promise`\<[`BulkUpdateEntityPropertyOptionsResponse`](../../../../../generated/properties/types.gen/type-aliases/BulkUpdateEntityPropertyOptionsResponse.md)\>

Apply multi-select option deltas atomically across this entity's properties.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `changes` | [`PropertyOptionDelta`](../../../entity/interfaces/PropertyOptionDelta.md)[] |

#### Returns

`Promise`\<[`BulkUpdateEntityPropertyOptionsResponse`](../../../../../generated/properties/types.gen/type-aliases/BulkUpdateEntityPropertyOptionsResponse.md)\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`updatePropertyOptions`](../../../entity/classes/PropertiedEntity.md#updatepropertyoptions)

***

### byId()

> `static` **byId**(`client`, `id`): `User`

A handle to a user by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`User`

***

### fromName()

> `static` **fromName**(`client`, `name`): `User`

A user handle seeded with an already loaded auth-service name.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `name` | [`UserName`](../../../../../generated/auth/types.gen/type-aliases/UserName.md) |

#### Returns

`User`

***

### me()

> `static` **me**(`client`): `Promise`\<`User`\>

A handle to the current authenticated user.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`User`\>
