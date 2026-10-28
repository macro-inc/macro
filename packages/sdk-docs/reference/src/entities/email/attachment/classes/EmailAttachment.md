# Class: EmailAttachment

A file attached to an email message. A thin handle keyed by attachment id;
the record loads lazily on first field access.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`EmailAttachmentData`](../type-aliases/EmailAttachmentData.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-contentid"></a> `contentId` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The attachment's Content-ID header value (for inline attachments). | - |
| <a id="property-dataurl"></a> `dataUrl` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | A URL to the attachment's raw data, when available. | - |
| <a id="property-filename"></a> `filename` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The attachment's original filename. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-mimetype"></a> `mimeType` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The attachment's MIME type. | - |
| <a id="property-sfsid"></a> `sfsId` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The attachment's static-file-service id, when it has been stored there. | - |
| <a id="property-size"></a> `size` | `readonly` | () => `Promise`\<`number` \| `undefined`\> | The attachment's size in bytes. | - |

## Methods

### toDocument()

> **toDocument**(): `Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

The Macro document holding this attachment's content. Get-or-create: the
server returns the existing document's id, or downloads the attachment
from the provider and uploads it as a new document first (deduplicated
behind a server-side lock).

#### Returns

`Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Attachment`](../../../../../generated/email/types.gen/type-aliases/Attachment.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Attachment`](../../../../../generated/email/types.gen/type-aliases/Attachment.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Attachment`](../../../../../generated/email/types.gen/type-aliases/Attachment.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `EmailAttachment`

A handle to an attachment by id. Fields load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`EmailAttachment`

***

### from()

> `static` **from**(`client`, `data`): `EmailAttachment`

Build an attachment from an already-fetched record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `data` | [`Attachment`](../../../../../generated/email/types.gen/type-aliases/Attachment.md) |

#### Returns

`EmailAttachment`
