# Type Alias: SoupDocumentSoupPropertiesField

> **SoupDocumentSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `branchedFromId?`: `string` \| `null`; `branchedFromVersionId?`: `number` \| `null`; `createdAt`: `string`; `deletedAt?`: `string` \| `null`; `documentFamilyId?`: `number` \| `null`; `documentVersionId`: `number`; `fileType?`: `string` \| `null`; `id`: `string`; `name`: `string`; `ownerId`: `string`; `projectId?`: `string` \| `null`; `sha?`: `string` \| `null`; `subType?`: `null` \| [`SoupDocumentSubType`](SoupDocumentSubType.md); `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

A document as displayed in Soup.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `branchedFromId?` | `string` \| `null` | The id of the document this document branched from |
| `branchedFromVersionId?` | `number` \| `null` | The id of the version this document branched from This could be either DocumentInstance or DocumentBom id depending on the file type |
| `createdAt` | `string` | The time the document was created |
| `deletedAt?` | `string` \| `null` | The time the document was deleted |
| `documentFamilyId?` | `number` \| `null` | The id of the document family this document belongs to |
| `documentVersionId` | `number` | The version of the document This could be the document_instance_id or document_bom_id depending on the file type |
| `fileType?` | `string` \| `null` | The file type of the document (e.g. pdf, docx) |
| `id` | `string` | The document id |
| `name` | `string` | The name of the document |
| `ownerId` | `string` | The owner of the document |
| `projectId?` | `string` \| `null` | The id of the project that this document belongs to |
| `sha?` | `string` \| `null` | If the document is a PDF, this is the SHA of the pdf If the document is a DOCX, this will not be present |
| `subType?` | `null` \| [`SoupDocumentSubType`](SoupDocumentSubType.md) | - |
| `updatedAt` | `string` | The time the document instance / document BOM was updated |
| `viewedAt?` | `string` \| `null` | The time the document was last viewed |
