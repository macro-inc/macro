# Type Alias: DocumentMetadata

> **DocumentMetadata** = \{ `branchedFromId?`: `string` \| `null`; `branchedFromVersionId?`: `number` \| `null`; `createdAt?`: `string` \| `null`; `deletedAt?`: `string` \| `null`; `documentBom?`: [`BomPart`](BomPart.md)[] \| `null`; `documentFamilyId?`: `number` \| `null`; `documentId`: `string`; `documentName`: `string`; `documentVersionId`: `number`; `fileType?`: `string` \| `null`; `modificationData?`: `unknown`; `owner`: `string`; `projectId?`: `string` \| `null`; `projectName?`: `string` \| `null`; `sha?`: `string` \| `null`; `subType?`: `null` \| [`DocumentSubType`](DocumentSubType.md); `updatedAt?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-branchedfromid"></a> `branchedFromId?` | `string` \| `null` | The id of the document this document branched from |
| <a id="property-branchedfromversionid"></a> `branchedFromVersionId?` | `number` \| `null` | The id of the version this document branched from This could be either DocumentInstance or DocumentBom id depending on the file type |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | The time the document was created |
| <a id="property-deletedat"></a> `deletedAt?` | `string` \| `null` | The time the document was deleted |
| <a id="property-documentbom"></a> `documentBom?` | [`BomPart`](BomPart.md)[] \| `null` | If the document is a DOCX document and unzipped, the document_bom will be present |
| <a id="property-documentfamilyid"></a> `documentFamilyId?` | `number` \| `null` | The id of the document family this document belongs to |
| <a id="property-documentid"></a> `documentId` | `string` | The document id |
| <a id="property-documentname"></a> `documentName` | `string` | The name of the document |
| <a id="property-documentversionid"></a> `documentVersionId` | `number` | The version of the document This could be the document_instance_id or document_bom_id depending on the file type |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | The file type of the document (file extension) |
| <a id="property-modificationdata"></a> `modificationData?` | `unknown` | The modification data for the document instance. This is only used for PDF documents. |
| <a id="property-owner"></a> `owner` | `string` | The owner of the document |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | The id of the project that this document belongs to |
| <a id="property-projectname"></a> `projectName?` | `string` \| `null` | The name of the project that this document belongs to |
| <a id="property-sha"></a> `sha?` | `string` \| `null` | If the document is a PDF, this is the SHA of the pdf If the document is a DOCX, this will not be present |
| <a id="property-subtype"></a> `subType?` | `null` \| [`DocumentSubType`](DocumentSubType.md) | - |
| <a id="property-updatedat"></a> `updatedAt?` | `string` \| `null` | The time the document instance / document BOM was updated |
