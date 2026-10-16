# Class: Message

A message in a channel. A thin handle: `id` and `channelId` are known up
front, and record-backed fields (`content`, `author`) load lazily on first
access and cache. Actions carry the ids for you.

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
