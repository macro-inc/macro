# Class: ExternalChatMessage

Message in an added external chat.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ExternalChatMessage`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMessage.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | `readonly` | () => `Promise`\<\{ `durationSeconds`: `number` \| `undefined`; `fileName`: `string`; `height`: `number` \| `undefined`; `mime`: `string`; `ordinal`: `number`; `presentation`: [`ExternalChatMediaPresentation`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMediaPresentation.md) \| `undefined`; `size`: `number`; `state`: [`ExternalChatAttachmentState`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatAttachmentState.md); `url`: `string` \| `undefined`; `width`: `number` \| `undefined`; \}[]\> | Attachment states, with the stored file's URL once ready. | - |
| <a id="property-body"></a> `body` | `readonly` | () => `Promise`\<`string`\> | Plain message text. | - |
| <a id="property-chat"></a> `chat` | `readonly` | [`ExternalChat`](../../chat/classes/ExternalChat.md) | The chat this message is in. | - |
| <a id="property-deleted"></a> `deleted` | `readonly` | () => `Promise`\<`boolean`\> | Deleted for everyone. | - |
| <a id="property-deliverystate"></a> `deliveryState` | `readonly` | () => `Promise`\<`NonNullable`\<ExternalChatDeliveryState \| null \| undefined\> \| `undefined`\> | Caller-owned send's delivery state, when present. | - |
| <a id="property-editedat"></a> `editedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Last edit time. | - |
| <a id="property-forwarded"></a> `forwarded` | `readonly` | () => `Promise`\<`boolean`\> | Forwarded from another chat. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<[`ExternalChatMessageKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMessageKind.md)\> | `message`, or `system` for something that happened in the chat (see `rich`). | - |
| <a id="property-mentions"></a> `mentions` | `readonly` | () => `Promise`\<[`ExternalChatMention`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMention.md)[]\> | People the body @-mentions: `@<token>` in the body is this person. | - |
| <a id="property-reactions"></a> `reactions` | `readonly` | () => `Promise`\<[`ExternalChatReaction`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatReaction.md)[]\> | Grouped emoji counts and caller's own reaction. | - |
| <a id="property-replyto"></a> `replyTo` | `readonly` | () => `Promise`\<`ExternalChatMessage` \| `undefined`\> | Quoted message in this chat. | - |
| <a id="property-rich"></a> `rich` | `readonly` | () => `Promise`\<`NonNullable`\<ExternalChatRichContent \| null \| undefined\> \| `undefined`\> | Poll (with tallies), location, contact cards, event or system line. | - |
| <a id="property-sender"></a> `sender` | `readonly` | () => `Promise`\<[`ExternalChatSender`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatSender.md)\> | Protocol-verified sender association and display name. | - |
| <a id="property-sentat"></a> `sentAt` | `readonly` | () => `Promise`\<`string`\> | Provider timestamp. | - |
| <a id="property-viewonce"></a> `viewOnce` | `readonly` | () => `Promise`\<`boolean`\> | Sent as view-once in the provider; Macro keeps and shows it like any media. | - |

## Methods

### toJSON()

> **toJSON**(): \{ `detail?`: [`ExternalChatMessage`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMessage.md); `id`: `string`; \}

Serialize as `{ id, detail }`, where `detail` is the cached record, or as
`{ id }` when nothing is cached yet. Never fetches. This is what
`JSON.stringify(handle)` uses; it is a snapshot for logging and transport,
not a typed read API, and the record's shape follows the API response
that seeded it.

#### Returns

\{ `detail?`: [`ExternalChatMessage`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMessage.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ExternalChatMessage`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMessage.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `chat`, `id`): `ExternalChatMessage`

Reference a message within its original chat.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `id` | `string` |

#### Returns

`ExternalChatMessage`

***

### from()

> `static` **from**(`client`, `chat`, `record`): `ExternalChatMessage`

Seed a message handle from a timeline response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `record` | [`ExternalChatMessage`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMessage.md) |

#### Returns

`ExternalChatMessage`
