# Class: MessageThread

A shared message thread with resolution and deletion operations.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ThreadState`](../../../../../generated/storage/types.gen/type-aliases/ThreadState.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-parent"></a> `parent` | `readonly` | [`MessageParent`](../type-aliases/MessageParent.md) | The entity containing this thread. | - |
| <a id="property-resolved"></a> `resolved` | `readonly` | () => `Promise`\<`boolean`\> | Whether the thread is resolved. | - |

## Methods

### delete()

> **delete**(`nonce?`): `Promise`\<`void`\>

Delete the entire thread, including replies.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `nonce?` | `string` |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ThreadState`](../../../../../generated/storage/types.gen/type-aliases/ThreadState.md); `id`: `string`; `parentId`: `string`; `parentType`: `"channel"` \| `"document"` \| `"call"` \| `"crm_company"` \| `"crm_contact"`; \}

Serialize identity with its owning resource.

#### Returns

\{ `detail?`: [`ThreadState`](../../../../../generated/storage/types.gen/type-aliases/ThreadState.md); `id`: `string`; `parentId`: `string`; `parentType`: `"channel"` \| `"document"` \| `"call"` \| `"crm_company"` \| `"crm_contact"`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ThreadState`](../../../../../generated/storage/types.gen/type-aliases/ThreadState.md) |
| `id` | `string` |
| `parentId` | `string` |
| `parentType` | `"channel"` \| `"document"` \| `"call"` \| `"crm_company"` \| `"crm_contact"` |

#### Overrides

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Resolve the thread or detach its annotation anchor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `detachAnchor?`: `boolean`; `nonce?`: `string`; `resolved?`: `boolean`; \} |
| `options.detachAnchor?` | `boolean` |
| `options.nonce?` | `string` |
| `options.resolved?` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `parent`, `id`): `MessageThread`

Construct a scoped thread handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `parent` | [`MessageParent`](../type-aliases/MessageParent.md) |
| `id` | `string` |

#### Returns

`MessageThread`
