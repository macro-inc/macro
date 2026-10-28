# Class: CallMessage

A message in a call's single persistent chat thread.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-callid"></a> `callId` | `readonly` | `string` | - | - |
| <a id="property-content"></a> `content` | `readonly` | () => `Promise`\<`string`\> | The message body (markdown). | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the message was created. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | When the message was last updated. | - |

## Methods

### author()

> **author**(): `Promise`\<[`User`](../../../users/user/classes/User.md)\>

The user who sent this message.

#### Returns

`Promise`\<[`User`](../../../users/user/classes/User.md)\>

***

### call()

> **call**(): [`CallRecord`](../../call-record/classes/CallRecord.md)

The call whose chat contains this message.

#### Returns

[`CallRecord`](../../call-record/classes/CallRecord.md)

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this message, preserving the rest of the call's chat.

#### Returns

`Promise`\<`void`\>

***

### edit()

> **edit**(`body`): `Promise`\<`CallMessage`\>

Replace this message's body.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |

#### Returns

`Promise`\<`CallMessage`\>

***

### reply()

> **reply**(`body`): `Promise`\<`CallMessage`\>

Reply in the call's canonical thread, including when this is a reply.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |

#### Returns

`Promise`\<`CallMessage`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `callId`, `id`): `CallMessage`

A handle to a message by id. Fields load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `callId` | `string` |
| `id` | `string` |

#### Returns

`CallMessage`

***

### from()

> `static` **from**(`client`, `callId`, `record`): `CallMessage`

Build a message from its record without another fetch.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `callId` | `string` |
| `record` | [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md) |

#### Returns

`CallMessage`
