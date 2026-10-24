# Class: WhatsAppUpload

A staged attachment scoped to one adopted group; use it in a deliberate media send.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-filename"></a> `filename?` | `readonly` | `string` | Display filename supplied by the server. |
| <a id="property-groupid"></a> `groupId` | `readonly` | `string` | The group this upload can be sent to. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Correlation identity of the staged upload. |
| <a id="property-kind"></a> `kind?` | `readonly` | [`LinkedMediaKind`](../../../../../generated/storage/types.gen/type-aliases/LinkedMediaKind.md) | Media category supplied by the server. |

## Methods

### toJSON()

> **toJSON**(): \{ `filename`: `string` \| `undefined`; `groupId`: `string`; `id`: `string`; `kind`: [`LinkedMediaKind`](../../../../../generated/storage/types.gen/type-aliases/LinkedMediaKind.md) \| `undefined`; \}

Serialize the upload reference without credentials.

#### Returns

\{ `filename`: `string` \| `undefined`; `groupId`: `string`; `id`: `string`; `kind`: [`LinkedMediaKind`](../../../../../generated/storage/types.gen/type-aliases/LinkedMediaKind.md) \| `undefined`; \}

| Name | Type |
| ------ | ------ |
| `filename` | `string` \| `undefined` |
| `groupId` | `string` |
| `id` | `string` |
| `kind` | [`LinkedMediaKind`](../../../../../generated/storage/types.gen/type-aliases/LinkedMediaKind.md) \| `undefined` |

***

### byId()

> `static` **byId**(`group`, `id`): `WhatsAppUpload`

Reference a previously staged upload in its original group.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `group` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) |
| `id` | `string` |

#### Returns

`WhatsAppUpload`

***

### from()

> `static` **from**(`group`, `record`): `WhatsAppUpload`

Seed a handle from the server's upload receipt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `group` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) |
| `record` | [`LinkedUploadedAttachment`](../../../../../generated/storage/types.gen/type-aliases/LinkedUploadedAttachment.md) |

#### Returns

`WhatsAppUpload`
