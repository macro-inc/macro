# Class: Channel

A channel.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`ChannelDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"channel"` | `'channel'` | Favorites identify channels as `channel`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | `...` | The channel's display name, resolved from the viewer's perspective. | - | - |
| <a id="property-type"></a> `type` | `readonly` | () => `Promise`\<[`ChannelType`](../../../../../generated/storage/types.gen/type-aliases/ChannelType.md)\> | `...` | The channel's type (e.g. `public`, `dm`, `private`). | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`Channel`\> | `...` | Search channels by content, most relevant first, auto-paginated. | - | - |

## Methods

### addParticipants()

> **addParticipants**(`users`): `Promise`\<`void`\>

Add users to the channel.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `users` | [`User`](../../../users/user/classes/User.md)[] |

#### Returns

`Promise`\<`void`\>

***

### agentConversations()

> **agentConversations**(): `Promise`\<[`AgentConversation`](../../../agent-sessions/conversation/classes/AgentConversation.md)[]\>

Conversations maintained by agents in this channel.

#### Returns

`Promise`\<[`AgentConversation`](../../../agent-sessions/conversation/classes/AgentConversation.md)[]\>

***

### attachments()

> **attachments**(`opts?`): `AsyncGenerator`\<[`ApiChannelAttachment`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelAttachment.md)\>

The attachments posted in this channel, auto-paginated.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `opts?` | \{ `pageSize?`: `number`; `type?`: `string`; \} | - |
| `opts.pageSize?` | `number` | - |
| `opts.type?` | `string` | Filter by type: `static` for images/videos, `dss` for documents. |

#### Returns

`AsyncGenerator`\<[`ApiChannelAttachment`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelAttachment.md)\>

***

### cancelAccessRequest()

> **cancelAccessRequest**(): `Promise`\<`void`\>

Withdraw the current user's pending request to join this channel.

#### Returns

`Promise`\<`void`\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the channel. This is not reversible.

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

> **favorite**(): `Promise`\<`Channel`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Channel`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### join()

> **join**(): `Promise`\<`void`\>

Join the channel as the current user.

#### Returns

`Promise`\<`void`\>

***

### joinCode()

> **joinCode**(): `Promise`\<`string`\>

A reusable code that lets a user join this channel.

#### Returns

`Promise`\<`string`\>

***

### leave()

> **leave**(): `Promise`\<`void`\>

Leave the channel as the current user.

#### Returns

`Promise`\<`void`\>

***

### message()

> **message**(`id`): [`Message`](../../message/classes/Message.md)

A handle to a message in this channel by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Message`](../../message/classes/Message.md)

***

### messages()

> **messages**(`opts?`): `AsyncGenerator`\<[`Message`](../../message/classes/Message.md)\>

Root messages in this channel, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `pageSize?`: `number`; \} |
| `opts.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<[`Message`](../../message/classes/Message.md)\>

***

### messagesAfter()

> **messagesAfter**(`after`, `opts?`): `AsyncGenerator`\<[`Message`](../../message/classes/Message.md)\>

Root messages created or replied to at or after `after`, most recent
first, auto-paginated. Use it to catch up after a disconnect.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `after` | `string` \| `Date` |
| `opts?` | \{ `pageSize?`: `number`; \} |
| `opts.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<[`Message`](../../message/classes/Message.md)\>

***

### messageThreadById()

> **messageThreadById**(`id`): [`MessageThread`](../../../messages/thread/classes/MessageThread.md)

A shared message thread scoped to this resource.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`MessageThread`](../../../messages/thread/classes/MessageThread.md)

***

### myAccessRequest()

> **myAccessRequest**(): `Promise`\<\{ `canRequest`: `boolean`; `request?`: [`ChannelAccessRequest`](../../access-request/classes/ChannelAccessRequest.md); `retryAfter?`: `string`; \}\>

The current user's latest request to join this channel, whether the
channel accepts requests, and when they may ask again after a denial or
withdrawal. Works without access to the channel.

#### Returns

`Promise`\<\{ `canRequest`: `boolean`; `request?`: [`ChannelAccessRequest`](../../access-request/classes/ChannelAccessRequest.md); `retryAfter?`: `string`; \}\>

***

### participants()

> **participants**(): `Promise`\<[`ApiChannelParticipant`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelParticipant.md)[]\>

The channel's members, with their roles and join times.

#### Returns

`Promise`\<[`ApiChannelParticipant`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelParticipant.md)[]\>

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

### recordActivity()

> **recordActivity**(`type`): `Promise`\<[`ChannelActivity`](../../activity/classes/ChannelActivity.md)\>

Record a view or interaction in this channel.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | [`ActivityType`](../../../../../generated/storage/types.gen/type-aliases/ActivityType.md) |

#### Returns

`Promise`\<[`ChannelActivity`](../../activity/classes/ChannelActivity.md)\>

***

### removeParticipants()

> **removeParticipants**(`users`): `Promise`\<`void`\>

Remove users from the channel.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `users` | [`User`](../../../users/user/classes/User.md)[] |

#### Returns

`Promise`\<`void`\>

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename the channel.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### requestAccess()

> **requestAccess**(): `Promise`\<[`ChannelAccessRequest`](../../access-request/classes/ChannelAccessRequest.md)\>

Ask this private or team channel's participants to let the current user
join. Asking again while a request is pending returns that request.

#### Returns

`Promise`\<[`ChannelAccessRequest`](../../access-request/classes/ChannelAccessRequest.md)\>

***

### send()

> **send**(`body`, `opts?`): `Promise`\<[`Message`](../../message/classes/Message.md)\>

Post a message. Plain text, or a rich body composed with `msg`.

Works with a channel webhook token as well as a normal one — see
[postToChannel](../../post/functions/postToChannel.md) for which endpoint that picks and what it costs.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |
| `opts?` | \{ `thread?`: [`Thread`](../../thread/classes/Thread.md); \} |
| `opts.thread?` | [`Thread`](../../thread/classes/Thread.md) |

#### Returns

`Promise`\<[`Message`](../../message/classes/Message.md)\>

***

### setPicture()

> **setPicture**(`picture?`): `Promise`\<`void`\>

Set an uploaded profile picture, or clear it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `picture?` | [`ChannelPicture`](../../picture/classes/ChannelPicture.md) |

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

### timelinePage()

> **timelinePage**(`selection?`): `Promise`\<\{ `entries`: (\{ `activity`: \{ `action`: `string`; `actor`: [`User`](../../../users/user/classes/User.md); `actor_id`: `string`; `id`: `string`; `occurred_at`: `string`; `payload?`: `unknown`; \}; `message?`: `undefined`; `type`: `"activity"`; \} \| \{ `activity?`: `undefined`; `message`: [`Message`](../../message/classes/Message.md); `type`: `"message"`; \})[]; `nextCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; `previousCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; \}\>

A mixed message and activity timeline page.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `selection?` | [`TimelineOptions`](../../../messages/thread/interfaces/TimelineOptions.md)\<[`Message`](../../message/classes/Message.md)\> |

#### Returns

`Promise`\<\{ `entries`: (\{ `activity`: \{ `action`: `string`; `actor`: [`User`](../../../users/user/classes/User.md); `actor_id`: `string`; `id`: `string`; `occurred_at`: `string`; `payload?`: `unknown`; \}; `message?`: `undefined`; `type`: `"activity"`; \} \| \{ `activity?`: `undefined`; `message`: [`Message`](../../message/classes/Message.md); `type`: `"message"`; \})[]; `nextCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; `previousCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; \}\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ApiChannelDetail`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelDetail.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ApiChannelDetail`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelDetail.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ApiChannelDetail`](../../../../../generated/storage/types.gen/type-aliases/ApiChannelDetail.md) |
| `id` | `string` |

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`toJSON`](../../../entity/classes/PropertiedEntity.md#tojson)

***

### typing()

> **typing**(`action`, `opts?`): `Promise`\<`void`\>

Broadcast a typing indicator, optionally scoped to a thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `action` | `"stop"` \| `"start"` |
| `opts?` | \{ `thread?`: [`Thread`](../../thread/classes/Thread.md); \} |
| `opts.thread?` | [`Thread`](../../thread/classes/Thread.md) |

#### Returns

`Promise`\<`void`\>

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Channel`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Channel`\>

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

The channel's URL in the Macro web app.

#### Returns

`string`

***

### byId()

> `static` **byId**(`client`, `id`): `Channel`

A handle to a channel by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Channel`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`Channel`\>

Create a channel. The caller becomes the owner.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `client` | `MacroClient` | - |
| `opts` | \{ `name?`: `string`; `participants?`: [`User`](../../../users/user/classes/User.md)[]; `team?`: [`Team`](../../../teams/team/classes/Team.md); `type`: [`ChannelType`](../../../../../generated/storage/types.gen/type-aliases/ChannelType.md); \} | - |
| `opts.name?` | `string` | - |
| `opts.participants?` | [`User`](../../../users/user/classes/User.md)[] | Participants to add, excluding the owner. |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) | Team, for team channels. |
| `opts.type` | [`ChannelType`](../../../../../generated/storage/types.gen/type-aliases/ChannelType.md) | - |

#### Returns

`Promise`\<`Channel`\>

***

### dm()

> `static` **dm**(`client`, `recipient`): `Promise`\<`Channel`\>

Open (creating if needed) the DM channel with a user.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `recipient` | [`User`](../../../users/user/classes/User.md) |

#### Returns

`Promise`\<`Channel`\>

***

### private()

> `static` **private**(`client`, `recipients`): `Promise`\<`Channel`\>

Open (creating if needed) the private group channel with a set of users.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `recipients` | [`User`](../../../users/user/classes/User.md)[] |

#### Returns

`Promise`\<`Channel`\>
