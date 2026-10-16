# Class: CrmComment

A comment on a CRM company or contact: a message whose parent is the
record, addressed by the record and the message UUID. Its record and
mutations are the ones document comments and channel messages use.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the comment was created. | - |
| <a id="property-deletedat"></a> `deletedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | When the comment was deleted, if it has been. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-parent"></a> `parent` | `readonly` | [`CrmCommentParent`](../interfaces/CrmCommentParent.md) | The company or contact this comment belongs to. | - |
| <a id="property-text"></a> `text` | `readonly` | () => `Promise`\<`string`\> | The comment's text (markdown). | - |
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

Delete this comment. Deleting a thread's root keeps its replies.

#### Returns

`Promise`\<`void`\>

***

### edit()

> **edit**(`body`): `Promise`\<`CrmComment`\>

Replace the comment's text. Only its author may.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |

#### Returns

`Promise`\<`CrmComment`\>

***

### reply()

> **reply**(`body`): `Promise`\<`CrmComment`\>

Reply in this comment's thread.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |

#### Returns

`Promise`\<`CrmComment`\>

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

> `static` **byId**(`client`, `parent`, `id`): `CrmComment`

A handle to a comment by id. Fields load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `parent` | [`CrmCommentParent`](../interfaces/CrmCommentParent.md) |
| `id` | `string` |

#### Returns

`CrmComment`

***

### from()

> `static` **from**(`client`, `parent`, `record`): `CrmComment`

Build a comment from a message record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `parent` | [`CrmCommentParent`](../interfaces/CrmCommentParent.md) |
| `record` | [`Message`](../../../../../generated/storage/types.gen/type-aliases/Message.md) |

#### Returns

`CrmComment`
