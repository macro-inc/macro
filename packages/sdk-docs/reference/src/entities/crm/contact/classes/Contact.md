# Class: Contact

A CRM contact: a person observed interacting with the team.

## Extends

- [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`ContactDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-company"></a> `company` | `readonly` | () => `Promise`\<[`Company`](../../company/classes/Company.md)\> | `...` | The CRM company this contact belongs to. | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the contact was first created in the CRM. | - | - |
| <a id="property-email"></a> `email` | `readonly` | () => `Promise`\<`string`\> | `...` | The contact's email address. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"crm_contact"` | `'crm_contact'` | Favorites identify CRM contacts as `crm_contact`. | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`entityType`](../../../entity/classes/FavoritableEntity.md#property-entitytype) | - |
| <a id="property-firstinteraction"></a> `firstInteraction` | `readonly` | () => `Promise`\<`string`\> | `...` | When the team first interacted with this contact. | - | - |
| <a id="property-hidden"></a> `hidden` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether the contact is hidden from CRM listings. | - | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`id`](../../../entity/classes/FavoritableEntity.md#property-id) |
| <a id="property-lastinteraction"></a> `lastInteraction` | `readonly` | () => `Promise`\<`string`\> | `...` | When the team last interacted with this contact. | - | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The contact's display name, if one has been observed. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the contact was last updated. | - | - |

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

A handle to one of this contact's comments by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CrmComment`](../../comment/classes/CrmComment.md)

***

### comments()

> **comments**(): `Promise`\<[`CrmCommentThread`](../../comment/interfaces/CrmCommentThread.md)[]\>

The comment threads on this contact, newest thread first.

#### Returns

`Promise`\<[`CrmCommentThread`](../../comment/interfaces/CrmCommentThread.md)[]\>

***

### favorite()

> **favorite**(): `Promise`\<`Contact`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Contact`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`favorite`](../../../entity/classes/FavoritableEntity.md#favorite)

***

### hide()

> **hide**(): `Promise`\<`void`\>

Hide the contact from CRM listings. Display-only; reversible with [unhide](#unhide).

#### Returns

`Promise`\<`void`\>

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename the contact for the caller's current team.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`CrmContactResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmContactResponse.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`CrmContactResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmContactResponse.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`CrmContactResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmContactResponse.md) |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`toJSON`](../../../entity/classes/FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Contact`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Contact`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`unfavorite`](../../../entity/classes/FavoritableEntity.md#unfavorite)

***

### unhide()

> **unhide**(): `Promise`\<`void`\>

Un-hide the contact, restoring it to CRM listings.

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `Contact`

A handle to a CRM contact by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Contact`

***

### from()

> `static` **from**(`client`, `data`): `Contact`

Build a contact from an API record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `data` | [`CrmContactResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmContactResponse.md) |

#### Returns

`Contact`
