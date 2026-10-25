# Class: ChatGeneration

A background chat generation. The stream belongs to exactly one chat.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-chat"></a> `chat` | `readonly` | [`Chat`](../../chat/classes/Chat.md) | Parent chat. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Stream identity. |
| <a id="property-message"></a> `message` | `readonly` | [`ChatMessage`](ChatMessage.md) | AI response message for this generation. |

## Methods

### stop()

> **stop**(): `Promise`\<`void`\>

Request cancellation of this generation.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `chatId`: `string`; `id`: `string`; `messageId`: `string`; \}

Serialize scoped identity.

#### Returns

\{ `chatId`: `string`; `id`: `string`; `messageId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `chatId` | `string` |
| `id` | `string` |
| `messageId` | `string` |

***

### byId()

> `static` **byId**(`client`, `chat`, `id`, `message`): `ChatGeneration`

Construct from a send receipt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `chat` | [`Chat`](../../chat/classes/Chat.md) |
| `id` | `string` |
| `message` | [`ChatMessage`](ChatMessage.md) |

#### Returns

`ChatGeneration`
