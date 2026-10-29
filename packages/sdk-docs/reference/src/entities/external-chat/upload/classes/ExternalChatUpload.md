# Class: ExternalChatUpload

A staged attachment scoped to one added chat; use it in a deliberate media send.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-chat"></a> `chat` | `readonly` | [`ExternalChat`](../../chat/classes/ExternalChat.md) | The chat this upload can be sent to. |
| <a id="property-filename"></a> `filename?` | `readonly` | `string` | Display filename supplied by the server. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Correlation identity of the staged upload. |
| <a id="property-kind"></a> `kind?` | `readonly` | [`ExternalChatMediaKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMediaKind.md) | Media category supplied by the server. |

## Methods

### toJSON()

> **toJSON**(): \{ `chat`: `string`; `filename`: `string` \| `undefined`; `id`: `string`; `kind`: [`ExternalChatMediaKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMediaKind.md) \| `undefined`; \}

Serialize the upload reference without credentials.

#### Returns

\{ `chat`: `string`; `filename`: `string` \| `undefined`; `id`: `string`; `kind`: [`ExternalChatMediaKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMediaKind.md) \| `undefined`; \}

| Name | Type |
| ------ | ------ |
| `chat` | `string` |
| `filename` | `string` \| `undefined` |
| `id` | `string` |
| `kind` | [`ExternalChatMediaKind`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatMediaKind.md) \| `undefined` |

***

### byId()

> `static` **byId**(`chat`, `id`): `ExternalChatUpload`

Reference a previously staged upload in its original chat.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `id` | `string` |

#### Returns

`ExternalChatUpload`

***

### from()

> `static` **from**(`chat`, `record`): `ExternalChatUpload`

Seed a handle from the server's upload receipt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `record` | [`ExternalChatUploadedAttachment`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatUploadedAttachment.md) |

#### Returns

`ExternalChatUpload`
