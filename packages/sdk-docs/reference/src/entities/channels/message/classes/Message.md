# Class: Message

A handle to a channel message, not the message record: `content`,
`createdAt`, `editedAt` and `updatedAt` are async functions to call and await.

`id`, `channelId` and `mentions` are plain properties. `mentions` is empty
unless a list, thread, or event supplied it. Record-backed reads load the
record once and cache it. Actions carry the ids for you.

Handles from [Channel.messages](../../channel/classes/Channel.md#messages), [Channel.messagesAfter](../../channel/classes/Channel.md#messagesafter),
[Channel.timelinePage](../../channel/classes/Channel.md#timelinepage) and [Thread.replies](../../thread/classes/Thread.md#replies) are seeded from the
page, so reads make no request. Handles from [Channel.message](../../channel/classes/Channel.md#message),
[Message.byId](#byid), [Channel.send](../../channel/classes/Channel.md#send), [Message.reply](#reply) and
channel events start empty and fetch the message on the first read. [react](#react), [edit](#edit)
and other writes drop the cache.

Read the sender with [author](#author) and thread replies with
[Thread.replies](../../thread/classes/Thread.md#replies). Reactions, attachments, bot or imported author
details, and the reply count and preview that list pages return have no
typed accessor on this handle. They can appear in `JSON.stringify(message)`
output for seeded handles (see [Message.toJSON](#tojson)), but that is a
serialization snapshot, not a supported read API.

Common pitfalls: `message.content` is a function, so call and await it;
record keys such as `message.sender_id` or `message.reactions` are
`undefined` on the handle rather than an error, and so are fields read
through the protected `message.detail` cache.

## Example

```ts
const me = await macro.users.me();
for await (const message of channel.messagesAfter(since)) {
  const [author, content] = await Promise.all([
    message.author(),
    message.content(),
  ]);
  if (author.id !== me.id) continue;
  const replies = await message.thread().replies();
  console.log(content.slice(0, 80), replies.length);
}
```

## Extends

- [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<[`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md)\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId` | `readonly` | `string` | `undefined` | - | - | - |
| <a id="property-content"></a> `content` | `readonly` | () => `Promise`\<`string`\> | `...` | The message body. | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the message was created. | - | - |
| <a id="property-editedat"></a> `editedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the message was last edited, if it has been. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"channel_message"` | `'channel_message'` | Favorites identify channel messages as `channel_message`. | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`entityType`](../../../entity/classes/FavoritableEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`id`](../../../entity/classes/FavoritableEntity.md#property-id) |
| <a id="property-mentions"></a> `mentions` | `readonly` | [`SimpleMention`](../../../../../generated/storage/types.gen/type-aliases/SimpleMention.md)[] | `[]` | Entities mentioned in this message, when a list, thread, or event supplied them. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the message was last updated. | - | - |

## Methods

### author()

> **author**(): `Promise`\<[`User`](../../../users/user/classes/User.md)\>

The user who sent this message.

#### Returns

`Promise`\<[`User`](../../../users/user/classes/User.md)\>

***

### channel()

> **channel**(): [`Channel`](../../channel/classes/Channel.md)

The channel this message is in.

#### Returns

[`Channel`](../../channel/classes/Channel.md)

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this message.

#### Returns

`Promise`\<`void`\>

***

### edit()

> **edit**(`body`): `Promise`\<`Message`\>

Replace this message's body.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |

#### Returns

`Promise`\<`Message`\>

***

### favorite()

> **favorite**(): `Promise`\<`Message`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Message`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`favorite`](../../../entity/classes/FavoritableEntity.md#favorite)

***

### permission()

> **permission**(): `Promise`\<\{ `permission`: [`EntityPermission`](../../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

Read the caller's effective permission on this entity.

#### Returns

`Promise`\<\{ `permission`: [`EntityPermission`](../../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`permission`](../../../entity/classes/FavoritableEntity.md#permission)

***

### react()

> **react**(`emoji`): `Promise`\<`Message`\>

Add an emoji reaction to this message.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `emoji` | `string` |

#### Returns

`Promise`\<`Message`\>

***

### reply()

> **reply**(`body`): `Promise`\<`Message`\>

Post a reply in this message's thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |

#### Returns

`Promise`\<`Message`\>

***

### thread()

> **thread**(): [`Thread`](../../thread/classes/Thread.md)

The thread rooted at this message.

#### Returns

[`Thread`](../../thread/classes/Thread.md)

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md); `id`: `string`; \}

Serialize as `{ id, detail }`, where `detail` is the cached record, or as
`{ id }` when nothing is cached yet. Never fetches. This is what
`JSON.stringify(handle)` uses; it is a snapshot for logging and transport,
not a typed read API, and the record's shape follows the API response
that seeded it.

#### Returns

\{ `detail?`: [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md) |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`toJSON`](../../../entity/classes/FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Message`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Message`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`unfavorite`](../../../entity/classes/FavoritableEntity.md#unfavorite)

***

### unreact()

> **unreact**(`emoji`): `Promise`\<`Message`\>

Remove one of your emoji reactions from this message.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `emoji` | `string` |

#### Returns

`Promise`\<`Message`\>

***

### byId()

> `static` **byId**(`client`, `channelId`, `id`, `mentions?`): `Message`

A handle to a message by id. Fields load on first access.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `client` | `MacroClient` | `undefined` |
| `channelId` | `string` | `undefined` |
| `id` | `string` | `undefined` |
| `mentions?` | [`SimpleMention`](../../../../../generated/storage/types.gen/type-aliases/SimpleMention.md)[] | `[]` |

#### Returns

`Message`

***

### from()

> `static` **from**(`client`, `channelId`, `data`): `Message`

Build a root or reply from a message record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `channelId` | `string` |
| `data` | [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md) |

#### Returns

`Message`
