# Class: Thread

A thread within a channel, rooted at a top-level message. Replies and
thread-scoped posting live here.

## Constructors

### Constructor

> **new Thread**(`client`, `channelId`, `rootId`): `Thread`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `client` | `MacroClient` | - |
| `channelId` | `string` | - |
| `rootId` | `string` | The id of the message this thread hangs off. |

#### Returns

`Thread`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId` | `readonly` | `string` | - |
| <a id="property-rootid"></a> `rootId` | `readonly` | `string` | The id of the message this thread hangs off. |

## Methods

### channel()

> **channel**(): [`Channel`](../../channel/classes/Channel.md)

The channel this thread is in.

#### Returns

[`Channel`](../../channel/classes/Channel.md)

***

### replies()

> **replies**(): `Promise`\<[`Message`](../../message/classes/Message.md)[]\>

List the replies in this thread, oldest first.

#### Returns

`Promise`\<[`Message`](../../message/classes/Message.md)[]\>

***

### reply()

> **reply**(`body`): `Promise`\<[`Message`](../../message/classes/Message.md)\>

Post a reply in this thread.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |

#### Returns

`Promise`\<[`Message`](../../message/classes/Message.md)\>

The created reply.

***

### root()

> **root**(): [`Message`](../../message/classes/Message.md)

The message this thread hangs off.

#### Returns

[`Message`](../../message/classes/Message.md)

***

### toJSON()

> **toJSON**(): \{ `channelId`: `string`; `rootId`: `string`; \}

Serialize the thread identity without its authenticated client.

#### Returns

\{ `channelId`: `string`; `rootId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `channelId` | `string` |
| `rootId` | `string` |
