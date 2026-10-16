# Class: Company

A CRM company: an organization the team has interacted with.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`CompanyDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the company was first created in the CRM. | - | - |
| <a id="property-description"></a> `description` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The company's display description, if any. | - | - |
| <a id="property-emailsync"></a> `emailSync` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether email sync is enabled for this company. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"crm_company"` | `'crm_company'` | Favorites identify CRM companies as `crm_company`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-hidden"></a> `hidden` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether the company is hidden from CRM listings. | - | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The company's display name, if resolved. | - | - |
| <a id="property-team"></a> `team` | `readonly` | () => `Promise`\<[`Team`](../../../teams/team/classes/Team.md)\> | `...` | The team that owns this company. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the company was last updated. | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`Company`\> | `...` | Search CRM companies by name/domain, most relevant first, auto-paginated. | - | - |

## Methods

### comment()

> **comment**(`body`, `opts?`): `Promise`\<[`CrmComment`](../../comment/classes/CrmComment.md)\>

Add a comment. Starts a new thread, or replies to an existing one when
`threadId` (the thread's root comment id) is given.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |
| `opts?` | \{ `threadId?`: `string`; \} | - |
| `opts.threadId?` | `string` | - |

#### Returns

`Promise`\<[`CrmComment`](../../comment/classes/CrmComment.md)\>

***

### commentById()

> **commentById**(`id`): [`CrmComment`](../../comment/classes/CrmComment.md)

A handle to one of this company's comments by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CrmComment`](../../comment/classes/CrmComment.md)

***

### comments()

> **comments**(): `Promise`\<[`CrmCommentThread`](../../comment/interfaces/CrmCommentThread.md)[]\>

The comment threads on this company, newest thread first.

#### Returns

`Promise`\<[`CrmCommentThread`](../../comment/interfaces/CrmCommentThread.md)[]\>

***

### contacts()

> **contacts**(): `Promise`\<[`Contact`](../../contact/classes/Contact.md)[]\>

The contacts attached to this company (hidden ones filtered for non-admins).

#### Returns

`Promise`\<[`Contact`](../../contact/classes/Contact.md)[]\>

***

### createContact()

> **createContact**(`opts`): `Promise`\<[`Contact`](../../contact/classes/Contact.md)\>

Create a contact under this company.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `email`: `string`; `name`: `string`; \} |
| `opts.email` | `string` |
| `opts.name` | `string` |

#### Returns

`Promise`\<[`Contact`](../../contact/classes/Contact.md)\>

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

### domain()

> **domain**(): `Promise`\<`string` \| `undefined`\>

The company's primary domain (e.g. `acme.com`), if any.

#### Returns

`Promise`\<`string` \| `undefined`\>

***

### domains()

> **domains**(): `Promise`\<`string`[]\>

All domains associated with the company, primary first.

#### Returns

`Promise`\<`string`[]\>

***

### favorite()

> **favorite**(): `Promise`\<`Company`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Company`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### hide()

> **hide**(): `Promise`\<`void`\>

Hide the company from CRM listings: disables email sync and soft-hides
its contacts. Reversible with [unhide](#unhide).

#### Returns

`Promise`\<`void`\>

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

Rename the company for the caller's current team.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### setEmailSync()

> **setEmailSync**(`enabled`): `Promise`\<`void`\>

Enable or disable team-wide email sync for this company. Rejects with 409
when enabling on a hidden company — [unhide](#unhide) first.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `enabled` | `boolean` |

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

### toJSON()

> **toJSON**(): \{ `detail?`: [`CrmCompanyResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmCompanyResponse.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`CrmCompanyResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmCompanyResponse.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`CrmCompanyResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmCompanyResponse.md) |
| `id` | `string` |

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`toJSON`](../../../entity/classes/PropertiedEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Company`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Company`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`unfavorite`](../../../entity/classes/PropertiedEntity.md#unfavorite)

***

### unhide()

> **unhide**(): `Promise`\<`void`\>

Un-hide the company, restoring it and its contacts to CRM listings.

#### Returns

`Promise`\<`void`\>

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

> `static` **byId**(`client`, `id`): `Company`

A handle to a CRM company by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Company`

***

### from()

> `static` **from**(`client`, `data`): `Company`

Build a company from an API record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `data` | [`CrmCompanyResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmCompanyResponse.md) |

#### Returns

`Company`
