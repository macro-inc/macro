# Class: ExternalChatsNamespace

Chats from external messaging providers (WhatsApp today) that someone added
to Macro: read, share and send in them. Find and add a provider's chats
through its own namespace, such as `macro.whatsapp.chats()`.

## Constructors

### Constructor

> **new ExternalChatsNamespace**(`client`): `ExternalChatsNamespace`

Bind external chat operations to this authenticated client.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ExternalChatsNamespace`

## Methods

### byId()

> **byId**(`id`): [`ExternalChat`](../../chat/classes/ExternalChat.md)

Reference an added chat without fetching it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`ExternalChat`](../../chat/classes/ExternalChat.md)

***

### list()

> **list**(): `Promise`\<[`ExternalChat`](../../chat/classes/ExternalChat.md)[]\>

Added chats the caller can view, including without a provider account of their own.

#### Returns

`Promise`\<[`ExternalChat`](../../chat/classes/ExternalChat.md)[]\>
