# Class: Comment

A comment on a document: a document-parent message, addressed by its
document and message UUID. Its record and mutations are the ones channel
messages use.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the comment was created. | - |
| <a id="property-documentid"></a> `documentId` | `readonly` | `string` | The document this comment belongs to. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-text"></a> `text` | `readonly` | () => `Promise`\<`string`\> | The comment's text. | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | When the comment was last updated. | - |

## Methods

### author()

> **author**(): `Promise`\<[`User`](../../../users/user/classes/User.md)\>

The user who wrote this comment.

#### Returns

`Promise`\<[`User`](../../../users/user/classes/User.md)\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this comment.

#### Returns

`Promise`\<`void`\>

***

### document()

> **document**(): [`Document`](../../document/classes/Document.md)

The document this comment is on.

#### Returns

[`Document`](../../document/classes/Document.md)

***

### edit()

> **edit**(`body`): `Promise`\<`Comment`\>

Replace the comment's text.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |

#### Returns

`Promise`\<`Comment`\>

***

### reply()

> **reply**(`body`): `Promise`\<`Comment`\>

Reply in this comment's thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |

#### Returns

`Promise`\<`Comment`\>

***

### threadId()

> **threadId**(): `Promise`\<`string`\>

The id of the thread this comment belongs to: its root, or itself for a root.

#### Returns

`Promise`\<`string`\>

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

> `static` **byId**(`client`, `documentId`, `id`): `Comment`

A handle to a comment by id. Fields load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `documentId` | `string` |
| `id` | `string` |

#### Returns

`Comment`

***

### from()

> `static` **from**(`client`, `documentId`, `record`): `Comment`

Build a comment from a message record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `documentId` | `string` |
| `record` | [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md) |

#### Returns

`Comment`
