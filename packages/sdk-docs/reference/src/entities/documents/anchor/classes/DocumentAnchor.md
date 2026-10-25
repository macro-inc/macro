# Class: DocumentAnchor

A PDF annotation scoped to its document.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Anchor`](../../../../../generated/storage/types.gen/type-aliases/Anchor.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-document"></a> `document` | `readonly` | [`Document`](../../document/classes/Document.md) | Owning document. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<`"highlight"` \| `"placeable"`\> | Annotation kind. | - |
| <a id="property-page"></a> `page` | `readonly` | () => `Promise`\<`number`\> | Page containing the annotation. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete a standalone highlight annotation.

#### Returns

`Promise`\<`void`\>

***

### edit()

> **edit**(`options`): `Promise`\<`void`\>

Edit a placeable comment's position and display settings.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Omit`\<[`EditPdfPlaceableCommentAnchorRequest`](../../../../../generated/storage/types.gen/type-aliases/EditPdfPlaceableCommentAnchorRequest.md), `"uuid"`\> |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`PdfAnchor`](../../../../../generated/storage/types.gen/type-aliases/PdfAnchor.md); `documentId`: `string`; `id`: `string`; \}

Serialize identity with its owning resource.

#### Returns

\{ `detail?`: [`PdfAnchor`](../../../../../generated/storage/types.gen/type-aliases/PdfAnchor.md); `documentId`: `string`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`PdfAnchor`](../../../../../generated/storage/types.gen/type-aliases/PdfAnchor.md) |
| `documentId` | `string` |
| `id` | `string` |

#### Overrides

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `document`, `id`): `DocumentAnchor`

Construct a document scoped annotation handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `document` | [`Document`](../../document/classes/Document.md) |
| `id` | `string` |

#### Returns

`DocumentAnchor`

***

### from()

> `static` **from**(`client`, `document`, `record`): `DocumentAnchor`

Seed an annotation from a document annotation listing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `document` | [`Document`](../../document/classes/Document.md) |
| `record` | [`PdfAnchor`](../../../../../generated/storage/types.gen/type-aliases/PdfAnchor.md) |

#### Returns

`DocumentAnchor`
