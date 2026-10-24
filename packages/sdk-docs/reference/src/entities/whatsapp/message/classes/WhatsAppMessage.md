# Class: WhatsAppMessage

Message in an independently shared WhatsApp group.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`WhatsAppGroupMessage`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupMessage.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | `readonly` | () => `Promise`\<\{ `document`: [`Document`](../../../documents/document/classes/Document.md) \| `undefined`; `durationSeconds`: `number` \| `undefined`; `fileName`: `string`; `height`: `number` \| `undefined`; `mime`: `string`; `ordinal`: `number`; `presentation`: [`LinkedMediaPresentation`](../../../../../generated/storage/types.gen/type-aliases/LinkedMediaPresentation.md) \| `undefined`; `size`: `number`; `state`: [`LinkedAttachmentState`](../../../../../generated/storage/types.gen/type-aliases/LinkedAttachmentState.md); `width`: `number` \| `undefined`; \}[]\> | Attachment state and imported document handles. | - |
| <a id="property-body"></a> `body` | `readonly` | () => `Promise`\<`string`\> | Plain WhatsApp text. | - |
| <a id="property-deleted"></a> `deleted` | `readonly` | () => `Promise`\<`boolean`\> | Deleted for everyone. | - |
| <a id="property-deliverystate"></a> `deliveryState` | `readonly` | () => `Promise`\<`NonNullable`\<LinkedDeliveryState \| null \| undefined\> \| `undefined`\> | Caller-owned send's delivery state, when present. | - |
| <a id="property-editedat"></a> `editedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Last edit time. | - |
| <a id="property-forwarded"></a> `forwarded` | `readonly` | () => `Promise`\<`boolean`\> | Forwarded from another chat. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<[`WhatsAppMessageKind`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppMessageKind.md)\> | `message`, or `system` for something that happened in the group (see `rich`). | - |
| <a id="property-mentions"></a> `mentions` | `readonly` | () => `Promise`\<[`WhatsAppMention`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppMention.md)[]\> | People the body @-mentions: `@<token>` in the body is this person. | - |
| <a id="property-reactions"></a> `reactions` | `readonly` | () => `Promise`\<[`WhatsAppGroupReaction`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupReaction.md)[]\> | Grouped emoji counts and caller's own reaction. | - |
| <a id="property-replyto"></a> `replyTo` | `readonly` | () => `Promise`\<`WhatsAppMessage` \| `undefined`\> | Quoted message in this group. | - |
| <a id="property-rich"></a> `rich` | `readonly` | () => `Promise`\<`NonNullable`\<WhatsAppRichContent \| null \| undefined\> \| `undefined`\> | Poll (with tallies), location, contact cards, event or system line. | - |
| <a id="property-sender"></a> `sender` | `readonly` | () => `Promise`\<[`WhatsAppGroupSender`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupSender.md)\> | Protocol-verified sender association and display name. | - |
| <a id="property-sentat"></a> `sentAt` | `readonly` | () => `Promise`\<`string`\> | WhatsApp timestamp. | - |

## Accessors

### groupId

#### Get Signature

> **get** **groupId**(): `string`

Group identity for checking reply/mutation scope.

##### Returns

`string`

## Methods

### toJSON()

> **toJSON**(): \{ `detail?`: [`WhatsAppGroupMessage`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupMessage.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`WhatsAppGroupMessage`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupMessage.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`WhatsAppGroupMessage`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupMessage.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `group`, `id`): `WhatsAppMessage`

Reference a message within its original group.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `group` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) |
| `id` | `string` |

#### Returns

`WhatsAppMessage`

***

### from()

> `static` **from**(`client`, `group`, `record`): `WhatsAppMessage`

Seed a message handle from a timeline response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `group` | [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md) |
| `record` | [`WhatsAppGroupMessage`](../../../../../generated/storage/types.gen/type-aliases/WhatsAppGroupMessage.md) |

#### Returns

`WhatsAppMessage`
