# Class: Project

A Macro project: a folder-like container for documents, chats, and subprojects.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`ProjectDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | [`EntityAccess`](../../../sharing/access/classes/EntityAccess.md) | `...` | Access requests and direct user grants. | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the project was created (RFC 3339 timestamp). | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"project"` | `'project'` | Favorites identify projects as `project`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | `...` | The project's display name. | - | - |
| <a id="property-parent"></a> `parent` | `readonly` | () => `Promise`\<`Project` \| `undefined`\> | `...` | The parent project, if this project is nested. | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`Project`\> | `...` | Search projects by name and content, most relevant first, auto-paginated. | - | - |

## Methods

### accessLevel()

> **accessLevel**(): `Promise`\<`"view"` \| `"comment"` \| `"edit"` \| `"owner"`\>

Read the caller's effective access level.

#### Returns

`Promise`\<`"view"` \| `"comment"` \| `"edit"` \| `"owner"`\>

***

### delete()

> **delete**(`opts?`): `Promise`\<`void`\>

Delete the project and its contents. Soft by default (reversible with
[restore](#restore)); pass `permanent: true` to delete irreversibly.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `permanent?`: `boolean`; \} |
| `opts.permanent?` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

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

### favorite()

> **favorite**(): `Promise`\<`Project`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Project`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### items()

> **items**(): `Promise`\<[`Item`](../../../../../generated/storage/types.gen/type-aliases/Item.md)[]\>

The items (documents, chats, subprojects) directly inside this project.

#### Returns

`Promise`\<[`Item`](../../../../../generated/storage/types.gen/type-aliases/Item.md)[]\>

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

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename the project.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### restore()

> **restore**(): `Promise`\<`void`\>

Restore a soft-deleted project.

#### Returns

`Promise`\<`void`\>

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

### sharePermissions()

> **sharePermissions**(): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Read this project's sharing configuration.

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Project`](../../../../../generated/storage/types.gen/type-aliases/Project.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Project`](../../../../../generated/storage/types.gen/type-aliases/Project.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Project`](../../../../../generated/storage/types.gen/type-aliases/Project.md) |
| `id` | `string` |

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`toJSON`](../../../entity/classes/PropertiedEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Project`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Project`\>

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

> `static` **byId**(`client`, `id`): `Project`

A handle to a project by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Project`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`Project`\>

Create a project, optionally nested inside a parent project.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `name`: `string`; `parent?`: `Project`; \} |
| `opts.name` | `string` |
| `opts.parent?` | `Project` |

#### Returns

`Promise`\<`Project`\>
