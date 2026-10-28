# Class: EmailDraft

A draft email. Sending remains an explicit separate operation.

## Extends

- [`EmailMessage`](../../message/classes/EmailMessage.md)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md)[]\> | The Bcc recipients. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`bcc`](../../message/classes/EmailMessage.md#property-bcc) |
| <a id="property-body"></a> `body` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The parsed message body, as the API returns it. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`body`](../../message/classes/EmailMessage.md#property-body) |
| <a id="property-cc"></a> `cc` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md)[]\> | The Cc recipients. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`cc`](../../message/classes/EmailMessage.md#property-cc) |
| <a id="property-draftgeneration"></a> `draftGeneration` | `readonly` | () => `Promise`\<`number` \| `undefined`\> | Edit generation to capture with content before saving or transferring it. | - |
| <a id="property-from"></a> `from` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md) \| `undefined`\> | The sender. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`from`](../../message/classes/EmailMessage.md#property-from) |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`EmailMessage`](../../message/classes/EmailMessage.md).[`id`](../../message/classes/EmailMessage.md#property-id) |
| <a id="property-labels"></a> `labels` | `readonly` | () => `Promise`\<[`LabelInfo`](../../../../../generated/email/types.gen/type-aliases/LabelInfo.md)[]\> | Labels on this message. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`labels`](../../message/classes/EmailMessage.md#property-labels) |
| <a id="property-link"></a> `link` | `readonly` | () => `Promise`\<[`Link`](../../link/classes/Link.md)\> | The inbox (email link) this message belongs to. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`link`](../../message/classes/EmailMessage.md#property-link) |
| <a id="property-sentat"></a> `sentAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The provider-internal date of the message. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`sentAt`](../../message/classes/EmailMessage.md#property-sentat) |
| <a id="property-subject"></a> `subject` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The message's subject line. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`subject`](../../message/classes/EmailMessage.md#property-subject) |
| <a id="property-to"></a> `to` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md)[]\> | The To recipients. | [`EmailMessage`](../../message/classes/EmailMessage.md).[`to`](../../message/classes/EmailMessage.md#property-to) |

## Methods

### addAttachment()

> **addAttachment**(`options`): `Promise`\<\{ `attachment`: [`DraftAttachment`](DraftAttachment.md); `contentType`: `string`; `uploadUrl`: `string`; \}\>

Reserve an attachment upload. Upload to the returned URL, then call complete().

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `fileName`: `string`; `sha`: `string`; `size`: `number`; `uploadId?`: `string`; \} |
| `options.fileName` | `string` |
| `options.sha` | `string` |
| `options.size` | `number` |
| `options.uploadId?` | `string` |

#### Returns

`Promise`\<\{ `attachment`: [`DraftAttachment`](DraftAttachment.md); `contentType`: `string`; `uploadUrl`: `string`; \}\>

***

### addLabel()

> **addLabel**(`label`): `Promise`\<`void`\>

Add a label to this message.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`Label`](../../label/classes/Label.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`addLabel`](../../message/classes/EmailMessage.md#addlabel)

***

### completeDraftAttachment()

> **completeDraftAttachment**(`attachmentId`, `draftGeneration?`): `Promise`\<`void`\>

Verify an uploaded attachment using the draft generation captured when its upload began.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `attachmentId` | `string` | `undefined` |
| `draftGeneration?` | `number` | `0` |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`completeDraftAttachment`](../../message/classes/EmailMessage.md#completedraftattachment)

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the draft.

#### Returns

`Promise`\<`void`\>

***

### forwardAttachment()

> **forwardAttachment**(`attachment`): `Promise`\<[`DraftAttachment`](DraftAttachment.md)\>

Forward an existing attachment into this draft.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `attachment` | [`EmailAttachment`](../../attachment/classes/EmailAttachment.md) |

#### Returns

`Promise`\<[`DraftAttachment`](DraftAttachment.md)\>

***

### operationStatus()

> **operationStatus**(): `Promise`\<[`MessageOperationResponse`](../../../../../generated/email/types.gen/type-aliases/MessageOperationResponse.md)\>

Read the draft's durable send, upload, or conflict status without retrying it.

#### Returns

`Promise`\<[`MessageOperationResponse`](../../../../../generated/email/types.gen/type-aliases/MessageOperationResponse.md)\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`operationStatus`](../../message/classes/EmailMessage.md#operationstatus)

***

### removeAttachment()

> **removeAttachment**(`attachment`): `Promise`\<`void`\>

Remove a draft attachment.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `attachment` | [`DraftAttachment`](DraftAttachment.md) |

#### Returns

`Promise`\<`void`\>

***

### removeLabel()

> **removeLabel**(`label`): `Promise`\<`void`\>

Remove a label from this message.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`Label`](../../label/classes/Label.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`removeLabel`](../../message/classes/EmailMessage.md#removelabel)

***

### resolveOperation()

> **resolveOperation**(`request`): `Promise`\<`void`\>

Resolve the displayed operation revision after the user chooses an action.
Retrying an uncertain send requires explicit duplicate-risk acceptance.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`ResolveMessageOperationRequest`](../../../../../generated/email/types.gen/type-aliases/ResolveMessageOperationRequest.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`resolveOperation`](../../message/classes/EmailMessage.md#resolveoperation)

***

### schedule()

> **schedule**(`sendTime`, `options?`): `Promise`\<`void`\>

Schedule this draft for sending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sendTime` | `string` |
| `options?` | \{ `includeSignature?`: `boolean`; \} |
| `options.includeSignature?` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### thread()

> **thread**(): `Promise`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

The thread this message belongs to.

#### Returns

`Promise`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`thread`](../../message/classes/EmailMessage.md#thread)

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ParsedMessage`](../../../../../generated/email/types.gen/type-aliases/ParsedMessage.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ParsedMessage`](../../../../../generated/email/types.gen/type-aliases/ParsedMessage.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ParsedMessage`](../../../../../generated/email/types.gen/type-aliases/ParsedMessage.md) |
| `id` | `string` |

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`toJSON`](../../message/classes/EmailMessage.md#tojson)

***

### transferDraft()

> **transferDraft**(`request`): `Promise`\<[`TransferDraftResponse`](../../../../../generated/email/types.gen/type-aliases/TransferDraftResponse.md)\>

Move a draft to another inbox using a caller-persisted operation UUID.
Continue editing the returned message_id; the original identity is retired.
On an interrupted response, use email.recoverDraftTransfer(operation_id).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`TransferDraftRequest`](../../../../../generated/email/types.gen/type-aliases/TransferDraftRequest.md) |

#### Returns

`Promise`\<[`TransferDraftResponse`](../../../../../generated/email/types.gen/type-aliases/TransferDraftResponse.md)\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`transferDraft`](../../message/classes/EmailMessage.md#transferdraft)

***

### unschedule()

> **unschedule**(): `Promise`\<`void`\>

Remove a scheduled send.

#### Returns

`Promise`\<`void`\>

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Replace draft content without changing its identity or sending it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`DraftOptions`](../type-aliases/DraftOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### verifyAttachment()

> **verifyAttachment**(`attachment`): `Promise`\<`void`\>

Complete verification of an uploaded attachment.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `attachment` | [`DraftAttachment`](DraftAttachment.md) |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `EmailDraft`

Construct a lazy draft handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`EmailDraft`

#### Overrides

[`EmailMessage`](../../message/classes/EmailMessage.md).[`byId`](../../message/classes/EmailMessage.md#byid)

***

### from()

> `static` **from**(`client`, `data`): [`EmailMessage`](../../message/classes/EmailMessage.md)

Build a message from an already-fetched record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `data` | [`ParsedMessage`](../../../../../generated/email/types.gen/type-aliases/ParsedMessage.md) |

#### Returns

[`EmailMessage`](../../message/classes/EmailMessage.md)

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`from`](../../message/classes/EmailMessage.md#from)

***

### send()

> `static` **send**(`client`, `opts`): `Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md) \| `undefined`\>

Send a new email message. Returns a handle when the API reports the created message's id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | [`SendEmailOptions`](../../message/interfaces/SendEmailOptions.md) |

#### Returns

`Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md) \| `undefined`\>

#### Inherited from

[`EmailMessage`](../../message/classes/EmailMessage.md).[`send`](../../message/classes/EmailMessage.md#send)
