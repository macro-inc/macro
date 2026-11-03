# Class: ExternalChat

A chat from an external messaging provider (WhatsApp today), added to Macro
by its owner and shareable like any other entity: a group or a direct chat.

## Extends

- [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<[`ExternalChatDetail`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-backfill"></a> `backfill` | `readonly` | () => `Promise`\<[`ExternalChatBackfill`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatBackfill.md) \| `undefined`\> | Importing earlier messages from the owner's phone after adding, if any. | - | - |
| <a id="property-cansend"></a> `canSend` | `readonly` | () => `Promise`\<`boolean`\> | Whether the caller can send from their own connected account. | - | - |
| <a id="property-disappearingseconds"></a> `disappearingSeconds` | `readonly` | () => `Promise`\<`number` \| `undefined`\> | The provider's disappearing-messages timer in seconds while on; Macro keeps the messages. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"external_chat"` | Canonical sharing and favorites kind. | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`entityType`](../../../entity/classes/FavoritableEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | - | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`id`](../../../entity/classes/FavoritableEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<[`ExternalChatKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatKind.md)\> | `group`, or `direct` for a one-to-one chat (only its owner sends). | - | - |
| <a id="property-limits"></a> `limits` | `readonly` | () => `Promise`\<[`ExternalChatCapabilities`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatCapabilities.md)\> | Supported sizes and mutation window. | - | - |
| <a id="property-members"></a> `members` | `readonly` | () => `Promise`\<[`ExternalChatMembers`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMembers.md) \| `undefined`\> | Current remote members (name, participants, announce), when known. | - | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Display name: the group's, or a direct chat's other person. | - | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | Actual owner, independent of provider membership. | - | - |
| <a id="property-participants"></a> `participants` | `readonly` | () => `Promise`\<[`ExternalChatParticipant`](../../participant/classes/ExternalChatParticipant.md)[]\> | Everyone in the chat, from its members; empty when none are known. | - | - |
| <a id="property-provider"></a> `provider` | `readonly` | () => `Promise`\<`"whatsapp"`\> | The messaging provider the chat lives in, such as `whatsapp`. | - | - |
| <a id="property-sendingidentity"></a> `sendingIdentity` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Caller's own verified sending identity. | - | - |
| <a id="property-sendreason"></a> `sendReason` | `readonly` | () => `Promise`\<`NonNullable`\<ExternalChatReplyBlock \| null \| undefined\> \| `undefined`\> | Reason sending is blocked. | - | - |
| <a id="property-unreadcount"></a> `unreadCount` | `readonly` | () => `Promise`\<`number`\> | Per-user unread count. | - | - |

## Methods

### community()

> **community**(): `Promise`\<[`WhatsAppCommunity`](../../../whatsapp/chat/type-aliases/WhatsAppCommunity.md) \| `undefined`\>

The community a group belongs to, if any: the community's own provider chat, its name, and whether this is its announcement group.

#### Returns

`Promise`\<[`WhatsAppCommunity`](../../../whatsapp/chat/type-aliases/WhatsAppCommunity.md) \| `undefined`\>

***

### delivery()

> **delivery**(`sends`): `Promise`\<[`ExternalChatSend`](../../send/classes/ExternalChatSend.md)[]\>

Read delivery for selected caller-owned intents or messages.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sends` | ([`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md) \| [`ExternalChatSend`](../../send/classes/ExternalChatSend.md))[] |

#### Returns

`Promise`\<[`ExternalChatSend`](../../send/classes/ExternalChatSend.md)[]\>

***

### favorite()

> **favorite**(): `Promise`\<`ExternalChat`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`ExternalChat`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`favorite`](../../../entity/classes/FavoritableEntity.md#favorite)

***

### markRead()

> **markRead**(`message`): `Promise`\<`void`\>

Advance the caller's own read cursor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md) |

#### Returns

`Promise`\<`void`\>

***

### messageAttachments()

> **messageAttachments**(`messages`): `Promise`\<\{ `attachments`: \{ `fileName`: `string`; `mime`: `string`; `ordinal`: `number`; `size`: `number`; `state`: [`ExternalChatAttachmentState`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatAttachmentState.md); `url`: `string` \| `undefined`; \}[]; `message`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); \}[]\>

Read attachment states for selected messages.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `messages` | [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md)[] |

#### Returns

`Promise`\<\{ `attachments`: \{ `fileName`: `string`; `mime`: `string`; `ordinal`: `number`; `size`: `number`; `state`: [`ExternalChatAttachmentState`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatAttachmentState.md); `url`: `string` \| `undefined`; \}[]; `message`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); \}[]\>

***

### messages()

> **messages**(`options?`): `AsyncGenerator`\<[`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md)\>

Iterate newest-first timeline pages lazily.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `limit?`: `number`; \} |
| `options.limit?` | `number` |

#### Returns

`AsyncGenerator`\<[`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md)\>

***

### permission()

> **permission**(): `Promise`\<\{ `permission`: [`EntityPermission`](../../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

Read the caller's effective permission on this entity.

#### Returns

`Promise`\<\{ `permission`: [`EntityPermission`](../../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`permission`](../../../entity/classes/FavoritableEntity.md#permission)

***

### permissions()

> **permissions**(): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Read standard link/team sharing settings.

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### refresh()

> **refresh**(): `Promise`\<`ExternalChat`\>

Reload detail, permissions and caller capabilities.

#### Returns

`Promise`\<`ExternalChat`\>

***

### remove()

> **remove**(): `Promise`\<`void`\>

Owner stops syncing the chat; history and established sharing stay.

#### Returns

`Promise`\<`void`\>

***

### send()

> **send**(`content`, `options`): `Promise`\<[`ExternalChatSend`](../../send/classes/ExternalChatSend.md)\>

Personal sessions and owner API credentials can send. Bots never send.
Preserve the idempotency key; uncertain outcomes are never automatically resent.
The server enforces one request per second per user.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `content` | [`ExternalChatContent`](../type-aliases/ExternalChatContent.md) |
| `options` | \{ `idempotencyKey`: `string`; `replyTo?`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); \} |
| `options.idempotencyKey` | `string` |
| `options.replyTo?` | [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md) |

#### Returns

`Promise`\<[`ExternalChatSend`](../../send/classes/ExternalChatSend.md)\>

***

### sends()

> **sends**(): `Promise`\<[`ExternalChatSend`](../../send/classes/ExternalChatSend.md)[]\>

Read only the caller's pending, uncertain or failed sends.

#### Returns

`Promise`\<[`ExternalChatSend`](../../send/classes/ExternalChatSend.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ExternalChatDetail`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatDetail.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ExternalChatDetail`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatDetail.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ExternalChatDetail`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatDetail.md) |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`toJSON`](../../../entity/classes/FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`ExternalChat`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`ExternalChat`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`unfavorite`](../../../entity/classes/FavoritableEntity.md#unfavorite)

***

### updatePermissions()

> **updatePermissions**(`update`): `Promise`\<`void`\>

Actual owner updates standard link/team sharing settings.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `update` | [`UpdateSharePermissionRequestV2`](../../../../../generated/storage/types.gen/type-aliases/UpdateSharePermissionRequestV2.md) |

#### Returns

`Promise`\<`void`\>

***

### upload()

> **upload**(`file`): `Promise`\<[`ExternalChatUpload`](../../upload/classes/ExternalChatUpload.md)\>

Stage a supported attachment for a deliberate send.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `file` | `Blob` \| `File` |

#### Returns

`Promise`\<[`ExternalChatUpload`](../../upload/classes/ExternalChatUpload.md)\>

***

### byId()

> `static` **byId**(`client`, `id`): `ExternalChat`

Reference an added chat; access is checked on each request.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`ExternalChat`
