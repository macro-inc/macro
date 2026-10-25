# Class: DocumentVersion

An immutable document version, scoped to its document.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-document"></a> `document` | `readonly` | [`Document`](../../document/classes/Document.md) | Parent document. |
| <a id="property-id"></a> `id` | `readonly` | `number` | Version number. |

## Methods

### read()

> **read**(): `Promise`\<[`GetDocumentResponseData`](../../../../../generated/storage/types.gen/type-aliases/GetDocumentResponseData.md)\>

Version metadata and the caller's access.

#### Returns

`Promise`\<[`GetDocumentResponseData`](../../../../../generated/storage/types.gen/type-aliases/GetDocumentResponseData.md)\>

***

### toJSON()

> **toJSON**(): \{ `documentId`: `string`; `id`: `number`; \}

Serialize only scoped identity.

#### Returns

\{ `documentId`: `string`; `id`: `number`; \}

| Name | Type |
| ------ | ------ |
| `documentId` | `string` |
| `id` | `number` |

***

### byId()

> `static` **byId**(`client`, `document`, `id`): `DocumentVersion`

Construct a version handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `document` | [`Document`](../../document/classes/Document.md) |
| `id` | `number` |

#### Returns

`DocumentVersion`
