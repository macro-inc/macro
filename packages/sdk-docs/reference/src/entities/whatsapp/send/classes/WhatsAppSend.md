# Class: WhatsAppSend

One deliberate send intent. Unknown outcomes must never be automatically resent.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`LinkedSendProgress`](../../../../../generated/storage/types.gen/type-aliases/LinkedSendProgress.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the send intent was created. | - |
| <a id="property-errorcode"></a> `errorCode` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Sanitized failure code, when present. | - |
| <a id="property-group"></a> `group` | `readonly` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) | Group entity containing this send. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-message"></a> `message` | `readonly` | () => `Promise`\<[`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md) \| `undefined`\> | Group message once WhatsApp accepted the send. | - |
| <a id="property-state"></a> `state` | `readonly` | () => `Promise`\<[`LinkedDeliveryState`](../../../../../generated/storage/types.gen/type-aliases/LinkedDeliveryState.md)\> | Last observed delivery state; refresh explicitly to poll again. | - |

## Methods

### refresh()

> **refresh**(): `Promise`\<`WhatsAppSend`\>

Fetch current delivery state without retrying or submitting the message.

#### Returns

`Promise`\<`WhatsAppSend`\>

***

### request()

> **request**(): `Promise`\<\{ `idempotencyKey`: `string`; `message`: [`WhatsAppReply`](../../group/type-aliases/WhatsAppReply.md); `replyTo?`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); \}\>

Inspect the original intent for reconciliation; never resubmit an unknown outcome automatically.

#### Returns

`Promise`\<\{ `idempotencyKey`: `string`; `message`: [`WhatsAppReply`](../../group/type-aliases/WhatsAppReply.md); `replyTo?`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); \}\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`LinkedSendProgress`](../../../../../generated/storage/types.gen/type-aliases/LinkedSendProgress.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`LinkedSendProgress`](../../../../../generated/storage/types.gen/type-aliases/LinkedSendProgress.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`LinkedSendProgress`](../../../../../generated/storage/types.gen/type-aliases/LinkedSendProgress.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `group`, `id`): `WhatsAppSend`

Reference a send intent within its original group.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `group` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) |
| `id` | `string` |

#### Returns

`WhatsAppSend`

***

### from()

> `static` **from**(`client`, `group`, `record`): `WhatsAppSend`

Seed a send handle from a server response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `group` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) |
| `record` | [`LinkedSendProgress`](../../../../../generated/storage/types.gen/type-aliases/LinkedSendProgress.md) |

#### Returns

`WhatsAppSend`
