# Class: WhatsAppGroup

Independently shareable adopted WhatsApp group entity.

## Extends

- [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<[`WhatsAppGroupDetail`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-backfill"></a> `backfill` | `readonly` | () => `Promise`\<[`LinkedBackfill`](../../../../../generated/storage/types.gen/type-aliases/LinkedBackfill.md) \| `undefined`\> | Importing earlier messages from the owner's phone after adding, if any. | - | - |
| <a id="property-cansend"></a> `canSend` | `readonly` | () => `Promise`\<`boolean`\> | Whether the caller can send from their own connected account. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"whatsapp_group"` | Canonical sharing and favorites kind. | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`entityType`](../../../entity/classes/FavoritableEntity.md#property-entitytype) | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | - | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`id`](../../../entity/classes/FavoritableEntity.md#property-id) |
| <a id="property-limits"></a> `limits` | `readonly` | () => `Promise`\<[`LinkedCapabilities`](../../../../../generated/storage/types.gen/type-aliases/LinkedCapabilities.md)\> | Supported sizes and mutation window. | - | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Display name. | - | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | Actual owner, independent of WhatsApp membership. | - | - |
| <a id="property-roster"></a> `roster` | `readonly` | () => `Promise`\<[`LinkedGroupInfo`](../../../../../generated/storage/types.gen/type-aliases/LinkedGroupInfo.md) \| `undefined`\> | Current remote roster, when available. | - | - |
| <a id="property-sendingidentity"></a> `sendingIdentity` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Caller's own verified sending identity. | - | - |
| <a id="property-sendreason"></a> `sendReason` | `readonly` | () => `Promise`\<`NonNullable`\<LinkedReplyBlock \| null \| undefined\> \| `undefined`\> | Reason sending is blocked. | - | - |
| <a id="property-unreadcount"></a> `unreadCount` | `readonly` | () => `Promise`\<`number`\> | Per-user unread count. | - | - |

## Methods

### delivery()

> **delivery**(`sends`): `Promise`\<[`WhatsAppSend`](../../send/classes/WhatsAppSend.md)[]\>

Read delivery for selected caller-owned intents or messages.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sends` | ([`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md) \| [`WhatsAppSend`](../../send/classes/WhatsAppSend.md))[] |

#### Returns

`Promise`\<[`WhatsAppSend`](../../send/classes/WhatsAppSend.md)[]\>

***

### detach()

> **detach**(): `Promise`\<`void`\>

Stop observation while preserving history and established sharing.

#### Returns

`Promise`\<`void`\>

***

### favorite()

> **favorite**(): `Promise`\<`WhatsAppGroup`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`WhatsAppGroup`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`favorite`](../../../entity/classes/FavoritableEntity.md#favorite)

***

### markRead()

> **markRead**(`message`): `Promise`\<`void`\>

Advance the caller's own read cursor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md) |

#### Returns

`Promise`\<`void`\>

***

### messageAttachments()

> **messageAttachments**(`messages`): `Promise`\<\{ `attachments`: \{ `document`: [`Document`](../../../documents/document/classes/Document.md) \| `undefined`; `fileName`: `string`; `mime`: `string`; `ordinal`: `number`; `size`: `number`; `state`: [`LinkedAttachmentState`](../../../../../generated/storage/types.gen/type-aliases/LinkedAttachmentState.md); \}[]; `message`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); \}[]\>

Read attachment states for selected messages.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `messages` | [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md)[] |

#### Returns

`Promise`\<\{ `attachments`: \{ `document`: [`Document`](../../../documents/document/classes/Document.md) \| `undefined`; `fileName`: `string`; `mime`: `string`; `ordinal`: `number`; `size`: `number`; `state`: [`LinkedAttachmentState`](../../../../../generated/storage/types.gen/type-aliases/LinkedAttachmentState.md); \}[]; `message`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); \}[]\>

***

### messages()

> **messages**(`options?`): `AsyncGenerator`\<[`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md)\>

Iterate newest-first timeline pages lazily.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `limit?`: `number`; \} |
| `options.limit?` | `number` |

#### Returns

`AsyncGenerator`\<[`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md)\>

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

> **refresh**(): `Promise`\<`WhatsAppGroup`\>

Reload detail, permissions and caller capabilities.

#### Returns

`Promise`\<`WhatsAppGroup`\>

***

### reply()

> **reply**(`content`, `options`): `Promise`\<[`WhatsAppSend`](../../send/classes/WhatsAppSend.md)\>

Personal sessions and owner API credentials can send. Bots never send.
Preserve the idempotency key; uncertain outcomes are never automatically resent.
The server enforces one request per second per user.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `content` | [`WhatsAppReply`](../type-aliases/WhatsAppReply.md) |
| `options` | \{ `idempotencyKey`: `string`; `replyTo?`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); \} |
| `options.idempotencyKey` | `string` |
| `options.replyTo?` | [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md) |

#### Returns

`Promise`\<[`WhatsAppSend`](../../send/classes/WhatsAppSend.md)\>

***

### sends()

> **sends**(): `Promise`\<[`WhatsAppSend`](../../send/classes/WhatsAppSend.md)[]\>

Read only the caller's pending, uncertain or failed sends.

#### Returns

`Promise`\<[`WhatsAppSend`](../../send/classes/WhatsAppSend.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`WhatsAppGroupDetail`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupDetail.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`WhatsAppGroupDetail`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupDetail.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`WhatsAppGroupDetail`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupDetail.md) |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`toJSON`](../../../entity/classes/FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`WhatsAppGroup`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`WhatsAppGroup`\>

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

> **upload**(`file`): `Promise`\<[`WhatsAppUpload`](../../upload/classes/WhatsAppUpload.md)\>

Stage a supported attachment for a deliberate send.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `file` | `Blob` \| `File` |

#### Returns

`Promise`\<[`WhatsAppUpload`](../../upload/classes/WhatsAppUpload.md)\>

***

### byId()

> `static` **byId**(`client`, `id`): `WhatsAppGroup`

Reference an adopted group; access is checked on each request.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`WhatsAppGroup`
