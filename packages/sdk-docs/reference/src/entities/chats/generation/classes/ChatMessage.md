# Class: ChatMessage

A message scoped to an AI chat.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ChatMessageWithAttachments`](../../../../../generated/cognition/types.gen/type-aliases/ChatMessageWithAttachments.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-chat"></a> `chat` | `readonly` | [`Chat`](../../chat/classes/Chat.md) | Parent chat. | - |
| <a id="property-content"></a> `content` | `readonly` | () => `Promise`\<[`ChatMessageContent`](../../../../../generated/cognition/types.gen/type-aliases/ChatMessageContent.md)\> | The message's generated content. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-role"></a> `role` | `readonly` | () => `Promise`\<[`Role`](../../../../../generated/cognition/types.gen/type-aliases/Role.md)\> | Role of the message author. | - |

## Methods

### refresh()

> **refresh**(): `Promise`\<`void`\>

Reload after a running generation changes or finishes.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `chatId`: `string`; `detail?`: [`ChatMessageWithAttachments`](../../../../../generated/cognition/types.gen/type-aliases/ChatMessageWithAttachments.md); `id`: `string`; \}

Serialize scoped identity and any loaded message.

#### Returns

\{ `chatId`: `string`; `detail?`: [`ChatMessageWithAttachments`](../../../../../generated/cognition/types.gen/type-aliases/ChatMessageWithAttachments.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `chatId` | `string` |
| `detail?` | [`ChatMessageWithAttachments`](../../../../../generated/cognition/types.gen/type-aliases/ChatMessageWithAttachments.md) |
| `id` | `string` |

#### Overrides

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `chat`, `id`): `ChatMessage`

Construct a chat message handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `chat` | [`Chat`](../../chat/classes/Chat.md) |
| `id` | `string` |

#### Returns

`ChatMessage`
