# Class: WhatsAppNamespace

The current user's WhatsApp account, paired through the Macro app, and its
chat list. Added chats are external chats: read and send in them through
`macro.externalChats`.

## Constructors

### Constructor

> **new WhatsAppNamespace**(`client`): `WhatsAppNamespace`

Bind existing-account operations to this authenticated client.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`WhatsAppNamespace`

## Methods

### account()

> **account**(): `Promise`\<[`WhatsAppAccount`](../../account/classes/WhatsAppAccount.md) \| `undefined`\>

Current owner's account, or undefined when no account has been connected.

#### Returns

`Promise`\<[`WhatsAppAccount`](../../account/classes/WhatsAppAccount.md) \| `undefined`\>

***

### chats()

> **chats**(): `Promise`\<[`WhatsAppChat`](../../chat/classes/WhatsAppChat.md)[]\>

The caller's WhatsApp chat list (groups and direct chats), newest
activity first: each chat says whether it is added, shared with the caller
or addable, and `chat.add()` adds it.

#### Returns

`Promise`\<[`WhatsAppChat`](../../chat/classes/WhatsAppChat.md)[]\>
