# Class: WhatsAppChat

One chat of the current user's WhatsApp chat list: a group or a direct chat.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`WhatsAppChat`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppChat.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-added"></a> `added` | `readonly` | () => `Promise`\<[`ExternalChat`](../../../external-chat/chat/classes/ExternalChat.md) \| `undefined`\> | The current user's own external chat for this chat, once added. | - |
| <a id="property-archived"></a> `archived` | `readonly` | () => `Promise`\<`boolean`\> | Archived in WhatsApp. | - |
| <a id="property-canadd"></a> `canAdd` | `readonly` | () => `Promise`\<`boolean`\> | Whether adding it to Macro works now. | - |
| <a id="property-cannotaddreason"></a> `cannotAddReason` | `readonly` | () => `Promise`\<`NonNullable`\<WhatsAppCannotAdd \| null \| undefined\> \| `undefined`\> | Why it can't be added (`not_in_group`, `community`, `own_chat`, `not_in_chat_list`), when it is neither added, shared nor addable. | - |
| <a id="property-community"></a> `community` | `readonly` | () => `Promise`\<[`WhatsAppCommunity`](../type-aliases/WhatsAppCommunity.md) \| `undefined`\> | The WhatsApp community a group belongs to, if any: the community's own chat, its name, and whether this is its announcement group. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<[`ExternalChatKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatKind.md)\> | `group` or `direct`. | - |
| <a id="property-lastactivityat"></a> `lastActivityAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Newest activity WhatsApp reported; unknown for saved contacts never written to. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Group subject (or member names), or the other person's name or number. | - |
| <a id="property-phonenumber"></a> `phoneNumber` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The other person's phone number (`+<digits>`) of a direct chat, when known. | - |
| <a id="property-pinned"></a> `pinned` | `readonly` | () => `Promise`\<`boolean`\> | Pinned in WhatsApp. | - |
| <a id="property-shared"></a> `shared` | `readonly` | () => `Promise`\<[`ExternalChat`](../../../external-chat/chat/classes/ExternalChat.md) \| `undefined`\> | Someone else's external chat for this chat, shared with the current user. | - |

## Methods

### add()

> **add**(): `Promise`\<[`ExternalChat`](../../../external-chat/chat/classes/ExternalChat.md)\>

Add the chat (a group or a direct chat) to Macro as the current user's
own external chat; its earlier messages are imported from the phone.
Adding it again returns the same chat. Only the owner sends in a direct
chat.

#### Returns

`Promise`\<[`ExternalChat`](../../../external-chat/chat/classes/ExternalChat.md)\>

***

### refresh()

> **refresh**(): `Promise`\<`WhatsAppChat`\>

Reload the chat's list entry.

#### Returns

`Promise`\<`WhatsAppChat`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`WhatsAppChat`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppChat.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`WhatsAppChat`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppChat.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`WhatsAppChat`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppChat.md) |
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
| `record` | [`WhatsAppChat`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppChat.md) |

#### Returns

`WhatsAppChat`
