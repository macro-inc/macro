# Class: ExternalChatSend

One deliberate send intent. Unknown outcomes must never be automatically resent.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ExternalChatSendProgress`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatSendProgress.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-chat"></a> `chat` | `readonly` | [`ExternalChat`](../../chat/classes/ExternalChat.md) | The chat containing this send. | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the send intent was created. | - |
| <a id="property-errorcode"></a> `errorCode` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Sanitized failure code, when present. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-message"></a> `message` | `readonly` | () => `Promise`\<[`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md) \| `undefined`\> | Chat message once the provider accepted the send. | - |
| <a id="property-state"></a> `state` | `readonly` | () => `Promise`\<[`ExternalChatDeliveryState`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatDeliveryState.md)\> | Last observed delivery state; refresh explicitly to poll again. | - |

## Methods

### refresh()

> **refresh**(): `Promise`\<`ExternalChatSend`\>

Fetch current delivery state without retrying or submitting the message.

#### Returns

`Promise`\<`ExternalChatSend`\>

***

### request()

> **request**(): `Promise`\<\{ `idempotencyKey`: `string`; `message`: [`ExternalChatContent`](../../chat/type-aliases/ExternalChatContent.md); `replyTo?`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); \}\>

Inspect the original intent for reconciliation; never resubmit an unknown outcome automatically.

#### Returns

`Promise`\<\{ `idempotencyKey`: `string`; `message`: [`ExternalChatContent`](../../chat/type-aliases/ExternalChatContent.md); `replyTo?`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); \}\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ExternalChatSendProgress`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatSendProgress.md); `id`: `string`; \}

Serialize as `{ id, detail }`, where `detail` is the cached record, or as
`{ id }` when nothing is cached yet. Never fetches. This is what
`JSON.stringify(handle)` uses; it is a snapshot for logging and transport,
not a typed read API, and the record's shape follows the API response
that seeded it.

#### Returns

\{ `detail?`: [`ExternalChatSendProgress`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatSendProgress.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ExternalChatSendProgress`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatSendProgress.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `chat`, `id`): `ExternalChatSend`

Reference a send intent within its original chat.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `id` | `string` |

#### Returns

`ExternalChatSend`

***

### from()

> `static` **from**(`client`, `chat`, `record`): `ExternalChatSend`

Seed a send handle from a server response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `record` | [`ExternalChatSendProgress`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatSendProgress.md) |

#### Returns

`ExternalChatSend`
