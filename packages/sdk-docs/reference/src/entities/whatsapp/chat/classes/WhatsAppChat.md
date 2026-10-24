# Class: WhatsAppChat

One chat of the current user's WhatsApp chat list: a group or a direct chat.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`LinkedChat`](../../../../../generated/storage/types.gen/type-aliases/LinkedChat.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-archived"></a> `archived` | `readonly` | () => `Promise`\<`boolean`\> | Archived in WhatsApp. | - |
| <a id="property-canadd"></a> `canAdd` | `readonly` | () => `Promise`\<`boolean`\> | Whether adding it to Macro works now. | - |
| <a id="property-cannotaddreason"></a> `cannotAddReason` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Why it can't be added, when it is neither added, shared nor addable. | - |
| <a id="property-community"></a> `community` | `readonly` | () => `Promise`\<[`LinkedCommunityReference`](../../../../../generated/storage/types.gen/type-aliases/LinkedCommunityReference.md) \| `undefined`\> | The WhatsApp community a group belongs to (`{ id, name, announcements }`), if any. | - |
| <a id="property-group"></a> `group` | `readonly` | () => `Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) \| `undefined`\> | The current user's own Macro group for this chat, once added. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<[`LinkedChatKind`](../../../../../generated/storage/types.gen/type-aliases/LinkedChatKind.md)\> | `group` or `direct`. | - |
| <a id="property-lastactivityat"></a> `lastActivityAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Newest activity WhatsApp reported, when known. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Group subject (or member names), or the other person's name or number. | - |
| <a id="property-pinned"></a> `pinned` | `readonly` | () => `Promise`\<`boolean`\> | Pinned in WhatsApp. | - |
| <a id="property-shared"></a> `shared` | `readonly` | () => `Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) \| `undefined`\> | Someone else's Macro group for this chat, shared with the current user. | - |

## Methods

### adopt()

> **adopt**(): `Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)\>

Add the chat (a group or a direct chat) to Macro as the current user's
own; its earlier messages are imported from the phone. Adding it again
returns the same chat. Only the owner sends in a direct chat.

#### Returns

`Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)\>

***

### refresh()

> **refresh**(): `Promise`\<`WhatsAppChat`\>

Reload the chat's list entry.

#### Returns

`Promise`\<`WhatsAppChat`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`LinkedChat`](../../../../../generated/storage/types.gen/type-aliases/LinkedChat.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`LinkedChat`](../../../../../generated/storage/types.gen/type-aliases/LinkedChat.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`LinkedChat`](../../../../../generated/storage/types.gen/type-aliases/LinkedChat.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `WhatsAppChat`

Reference a chat by its WhatsApp JID.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`WhatsAppChat`

***

### from()

> `static` **from**(`client`, `record`): `WhatsAppChat`

Seed a chat handle from the chat list.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`LinkedChat`](../../../../../generated/storage/types.gen/type-aliases/LinkedChat.md) |

#### Returns

`WhatsAppChat`
