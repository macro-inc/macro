# Class: Chat

A Macro AI chat.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`ChatDetail`\>

## Implements

- [`Mentionable`](../../../../mentions/interfaces/Mentionable.md)

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | [`EntityAccess`](../../../sharing/access/classes/EntityAccess.md) | `...` | Access requests and direct user grants. | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the chat was created. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"chat"` | `'chat'` | Favorites identify chats as `chat`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |
| <a id="property-messages"></a> `messages` | `readonly` | () => `Promise`\<[`ChatMessageWithAttachments`](../../../../../generated/cognition/types.gen/type-aliases/ChatMessageWithAttachments.md)[]\> | `...` | The messages in the chat, with their attachments. | - | - |
| <a id="property-model"></a> `model` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The model used to generate the chat (`provider/model` id), if set. | - | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | `...` | The chat's display name. | - | - |
| <a id="property-project"></a> `project` | `readonly` | () => `Promise`\<[`Project`](../../../projects/project/classes/Project.md) \| `undefined`\> | `...` | The project this chat belongs to, if any. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the chat was last updated. | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`Chat`\> | `...` | Search chats by name and content, most relevant first, auto-paginated. | - | - |

## Methods

### copy()

> **copy**(): `Promise`\<`Chat`\>

Copy the chat, returning a handle to the new copy.

#### Returns

`Promise`\<`Chat`\>

***

### delete()

> **delete**(`opts?`): `Promise`\<`void`\>

Delete the chat. Soft by default (reversible with [restore](#restore));
pass `permanent: true` to delete irreversibly.

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

> **favorite**(): `Promise`\<`Chat`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Chat`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### history()

> **history**(): `Promise`\<[`ConversationRecord`](../../../../../generated/cognition/types.gen/type-aliases/ConversationRecord.md)[]\>

The chat's conversation history: titled records of messages with attachment ids.

#### Returns

`Promise`\<[`ConversationRecord`](../../../../../generated/cognition/types.gen/type-aliases/ConversationRecord.md)[]\>

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

Rename the chat.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### restore()

> **restore**(): `Promise`\<`void`\>

Restore a soft-deleted chat.

#### Returns

`Promise`\<`void`\>

***

### send()

> **send**(`options`): `Promise`\<[`ChatGeneration`](../../generation/classes/ChatGeneration.md)\>

Send a message and start a background generation. Tools may perform writes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Omit`\<[`HttpSendChatMessageRequest`](../../../../../generated/cognition/types.gen/type-aliases/HttpSendChatMessageRequest.md), `"chat_id"` \| `"attachments"` \| `"additional_instructions"`\> & \{ `additionalInstructions?`: `string`; `attachments?`: [`EntityReference`](../../../reference/type-aliases/EntityReference.md)[]; \} |

#### Returns

`Promise`\<[`ChatGeneration`](../../generation/classes/ChatGeneration.md)\>

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

> **toJSON**(): \{ `detail?`: [`ChatResponse`](../../../../../generated/cognition/types.gen/type-aliases/ChatResponse.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ChatResponse`](../../../../../generated/cognition/types.gen/type-aliases/ChatResponse.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ChatResponse`](../../../../../generated/cognition/types.gen/type-aliases/ChatResponse.md) |
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

> **unfavorite**(): `Promise`\<`Chat`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Chat`\>

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

### webUrl()

> **webUrl**(): `string`

The chat's URL in the Macro web app.

#### Returns

`string`

***

### byId()

> `static` **byId**(`client`, `id`): `Chat`

A handle to a chat by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Chat`

***

### create()

> `static` **create**(`client`, `opts?`): `Promise`\<`Chat`\>

Create a chat, optionally named and attached to a project.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts?` | \{ `name?`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.name?` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<`Chat`\>
