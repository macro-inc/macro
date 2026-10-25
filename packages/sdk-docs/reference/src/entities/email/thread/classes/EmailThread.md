# Class: EmailThread

An email thread. A free-to-construct handle: the detail record (including
up to the first 100 messages) loads lazily on first field access.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`ThreadDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | [`EntityAccess`](../../../sharing/access/classes/EntityAccess.md) | `...` | Access requests and direct user grants. | - | - |
| <a id="property-accesslevel"></a> `accessLevel` | `readonly` | () => `Promise`\<[`AccessLevel`](../../../../../generated/email/types.gen/type-aliases/AccessLevel.md)\> | `...` | The viewer's access level to this thread. | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the thread was created. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"email_thread"` | `'email_thread'` | Favorites identify email threads as `email_thread`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |
| <a id="property-inboxvisible"></a> `inboxVisible` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether the thread is visible in the inbox (i.e. not archived). | - | - |
| <a id="property-isread"></a> `isRead` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether the thread has been read. | - | - |
| <a id="property-latestinboundat"></a> `latestInboundAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | Timestamp of the latest inbound message, if any. | - | - |
| <a id="property-latestnonspamat"></a> `latestNonSpamAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | Timestamp of the latest non-spam message, if any. | - | - |
| <a id="property-latestoutboundat"></a> `latestOutboundAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | Timestamp of the latest outbound message, if any. | - | - |
| <a id="property-link"></a> `link` | `readonly` | () => `Promise`\<[`Link`](../../link/classes/Link.md)\> | `...` | The inbox (email link) that owns this thread. | - | - |
| <a id="property-project"></a> `project` | `readonly` | () => `Promise`\<[`Project`](../../../projects/project/classes/Project.md) \| `undefined`\> | `...` | The project this thread is attached to, if any. | - | - |
| <a id="property-providerid"></a> `providerId` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The provider-internal thread id (e.g. Gmail/Outlook), if any. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the thread was last updated. | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`EmailThread`\> | `...` | Search email threads by subject and content, most relevant first, auto-paginated. | - | - |

## Methods

### addLabel()

> **addLabel**(`label`): `Promise`\<`void`\>

Add a label to every message in the thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`Label`](../../label/classes/Label.md) |

#### Returns

`Promise`\<`void`\>

***

### archive()

> **archive**(`archived?`): `Promise`\<`void`\>

Archive the thread (or unarchive with `false`).

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `archived?` | `boolean` | `true` |

#### Returns

`Promise`\<`void`\>

***

### attachments()

> **attachments**(): `Promise`\<[`EmailAttachment`](../../attachment/classes/EmailAttachment.md)[]\>

The attachments across this thread's first 100 messages, pre-seeded from the thread detail.

#### Returns

`Promise`\<[`EmailAttachment`](../../attachment/classes/EmailAttachment.md)[]\>

***

### calendarInvitations()

> **calendarInvitations**(): `Promise`\<\{\[`key`: `string`\]: [`InvitationResolution`](../../../../../generated/email/types.gen/type-aliases/InvitationResolution.md); \}\>

Calendar invitations resolved from this thread's messages.

#### Returns

`Promise`\<\{\[`key`: `string`\]: [`InvitationResolution`](../../../../../generated/email/types.gen/type-aliases/InvitationResolution.md); \}\>

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

> **favorite**(): `Promise`\<`EmailThread`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`EmailThread`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### followup()

> **followup**(): `Promise`\<[`EmailFollowupResponse`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowupResponse.md)\>

Read follow-up state for this thread.

#### Returns

`Promise`\<[`EmailFollowupResponse`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowupResponse.md)\>

***

### markSeen()

> **markSeen**(): `Promise`\<`void`\>

Mark the thread as seen.

#### Returns

`Promise`\<`void`\>

***

### messages()

> **messages**(`opts?`): `Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md)[]\>

The messages in this thread, pre-seeded from the list endpoint.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `limit?`: `number`; `since?`: `string`; \} |
| `opts.limit?` | `number` |
| `opts.since?` | `string` |

#### Returns

`Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md)[]\>

***

### moveToProject()

> **moveToProject**(`project`): `Promise`\<`void`\>

Attach the thread to a project, or clear the project with `null`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `project` | [`Project`](../../../projects/project/classes/Project.md) \| `null` |

#### Returns

`Promise`\<`void`\>

***

### operations()

> **operations**(): `Promise`\<[`MailboxOperation`](../../../../../generated/email/types.gen/type-aliases/MailboxOperation.md)[]\>

Read pending or failed mailbox changes without initiating a retry.

#### Returns

`Promise`\<[`MailboxOperation`](../../../../../generated/email/types.gen/type-aliases/MailboxOperation.md)[]\>

***

### participants()

> **participants**(): `Promise`\<[`ApiContactInfo`](../../../../../generated/email/types.gen/type-aliases/ApiContactInfo.md)[]\>

Everyone on the thread (senders and recipients), deduped by email.
Derived from the thread's first 100 messages.

#### Returns

`Promise`\<[`ApiContactInfo`](../../../../../generated/email/types.gen/type-aliases/ApiContactInfo.md)[]\>

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

### removeLabel()

> **removeLabel**(`label`): `Promise`\<`void`\>

Remove a label from every message in the thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`Label`](../../label/classes/Label.md) |

#### Returns

`Promise`\<`void`\>

***

### reply()

> **reply**(`opts`): `Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md) \| `undefined`\>

Send a reply within this thread. Returns a handle when the API reports the created message's id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`ReplyEmailOptions`](../interfaces/ReplyEmailOptions.md) |

#### Returns

`Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md) \| `undefined`\>

***

### setFollowup()

> **setFollowup**(`command`): `Promise`\<[`EmailFollowup`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowup.md)\>

Set or remove a follow-up using a persisted operation id and revision.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `command` | [`EmailFollowupCommand`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowupCommand.md) |

#### Returns

`Promise`\<[`EmailFollowup`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowup.md)\>

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

### subject()

> **subject**(): `Promise`\<`string` \| `undefined`\>

The thread's subject, from its first message with one.

#### Returns

`Promise`\<`string` \| `undefined`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ApiThread`](../../../../../generated/email/types.gen/type-aliases/ApiThread.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ApiThread`](../../../../../generated/email/types.gen/type-aliases/ApiThread.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ApiThread`](../../../../../generated/email/types.gen/type-aliases/ApiThread.md) |
| `id` | `string` |

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`toJSON`](../../../entity/classes/PropertiedEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`EmailThread`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`EmailThread`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`unfavorite`](../../../entity/classes/PropertiedEntity.md#unfavorite)

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Change project membership or share permissions for this thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `project?`: [`Project`](../../../projects/project/classes/Project.md) \| `null`; `sharePermission?`: [`SharePermissionOptions`](../../../sharing/permissions/type-aliases/SharePermissionOptions.md); \} |
| `options.project?` | [`Project`](../../../projects/project/classes/Project.md) \| `null` |
| `options.sharePermission?` | [`SharePermissionOptions`](../../../sharing/permissions/type-aliases/SharePermissionOptions.md) |

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

### updateState()

> **updateState**(`request`): `Promise`\<`void`\>

Update provider-neutral read, trash, spam, or star state.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`UpdateThreadStateRequest`](../../../../../generated/email/types.gen/type-aliases/UpdateThreadStateRequest.md) |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `EmailThread`

A handle to a thread by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`EmailThread`
