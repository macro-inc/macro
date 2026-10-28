# Class: EmailMessage

A message in an email thread. A thin handle keyed by message id; the
record loads lazily on first field access.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`EmailMessageData`](../type-aliases/EmailMessageData.md)\>

## Extended by

- [`EmailDraft`](../../draft/classes/EmailDraft.md)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md)[]\> | The Bcc recipients. | - |
| <a id="property-body"></a> `body` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The parsed message body, as the API returns it. | - |
| <a id="property-cc"></a> `cc` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md)[]\> | The Cc recipients. | - |
| <a id="property-from"></a> `from` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md) \| `undefined`\> | The sender. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-labels"></a> `labels` | `readonly` | () => `Promise`\<[`LabelInfo`](../../../../../generated/email/types.gen/type-aliases/LabelInfo.md)[]\> | Labels on this message. | - |
| <a id="property-link"></a> `link` | `readonly` | () => `Promise`\<[`Link`](../../link/classes/Link.md)\> | The inbox (email link) this message belongs to. | - |
| <a id="property-sentat"></a> `sentAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The provider-internal date of the message. | - |
| <a id="property-subject"></a> `subject` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The message's subject line. | - |
| <a id="property-to"></a> `to` | `readonly` | () => `Promise`\<[`ContactInfo`](../../../../../generated/email/types.gen/type-aliases/ContactInfo.md)[]\> | The To recipients. | - |

## Methods

### addLabel()

> **addLabel**(`label`): `Promise`\<`void`\>

Add a label to this message.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`Label`](../../label/classes/Label.md) |

#### Returns

`Promise`\<`void`\>

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

***

### operationStatus()

> **operationStatus**(): `Promise`\<[`MessageOperationResponse`](../../../../../generated/email/types.gen/type-aliases/MessageOperationResponse.md)\>

Read the draft's durable send, upload, or conflict status without retrying it.

#### Returns

`Promise`\<[`MessageOperationResponse`](../../../../../generated/email/types.gen/type-aliases/MessageOperationResponse.md)\>

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

***

### thread()

> **thread**(): `Promise`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

The thread this message belongs to.

#### Returns

`Promise`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

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

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

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

***

### byId()

> `static` **byId**(`client`, `id`): `EmailMessage`

A handle to a message by id. Fields load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`EmailMessage`

***

### from()

> `static` **from**(`client`, `data`): `EmailMessage`

Build a message from an already-fetched record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `data` | [`ParsedMessage`](../../../../../generated/email/types.gen/type-aliases/ParsedMessage.md) |

#### Returns

`EmailMessage`

***

### send()

> `static` **send**(`client`, `opts`): `Promise`\<`EmailMessage` \| `undefined`\>

Send a new email message. Returns a handle when the API reports the created message's id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | [`SendEmailOptions`](../interfaces/SendEmailOptions.md) |

#### Returns

`Promise`\<`EmailMessage` \| `undefined`\>
