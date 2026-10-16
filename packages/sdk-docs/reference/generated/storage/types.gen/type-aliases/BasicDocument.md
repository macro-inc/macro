# Type Alias: BasicDocument

> **BasicDocument** = \{ `branchedFromId?`: `string` \| `null`; `branchedFromVersionId?`: `number` \| `null`; `createdAt?`: `string` \| `null`; `deletedAt?`: `string` \| `null`; `documentFamilyId?`: `number` \| `null`; `documentVersionId`: `number`; `fileType?`: `string` \| `null`; `id`: `string`; `name`: `string`; `owner`: `string`; `projectId?`: `string` \| `null`; `sha?`: `string` \| `null`; `subType?`: `null` \| [`BasicDocumentSubType`](BasicDocumentSubType.md); `updatedAt?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-branchedfromid"></a> `branchedFromId?` | `string` \| `null` | The id of the document this document branched from |
| <a id="property-branchedfromversionid"></a> `branchedFromVersionId?` | `number` \| `null` | The id of the version this document branched from This could be either DocumentInstance or DocumentBom id depending on the file type |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | The time the document was created |
| <a id="property-deletedat"></a> `deletedAt?` | `string` \| `null` | The time the document was deleted |
| <a id="property-documentfamilyid"></a> `documentFamilyId?` | `number` \| `null` | The id of the document family this document belongs to |
| <a id="property-documentversionid"></a> `documentVersionId` | `number` | The version of the document This could be the document_instance_id or document_bom_id depending on the file type |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | The file type of the document (e.g. pdf, docx) |
| <a id="property-id"></a> `id` | `string` | The document id |
| <a id="property-name"></a> `name` | `string` | The name of the document |
| <a id="property-owner"></a> `owner` | `string` | The owner of the document |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | The id of the project that this document belongs to |
| <a id="property-sha"></a> `sha?` | `string` \| `null` | If the document is a PDF, this is the SHA of the pdf If the document is a DOCX, this will not be present |
| <a id="property-subtype"></a> `subType?` | `null` \| [`BasicDocumentSubType`](BasicDocumentSubType.md) | - |
| <a id="property-updatedat"></a> `updatedAt?` | `string` \| `null` | The time the document instance / document BOM was updated |
