# Type Alias: GetDocumentListResult

> **GetDocumentListResult** = \{ `branchedFromId?`: `string` \| `null`; `branchedFromVersionId?`: `number` \| `null`; `createdAt?`: `string` \| `null`; `documentFamilyId?`: `number` \| `null`; `documentId`: `string`; `documentName`: `string`; `documentVersionId`: `number`; `fileType?`: `string` \| `null`; `updatedAt?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-branchedfromid"></a> `branchedFromId?` | `string` \| `null` | The id of the document this document branched from |
| <a id="property-branchedfromversionid"></a> `branchedFromVersionId?` | `number` \| `null` | The id of the version this document branched from This could be either DocumentInstance or DocumentBom id depending on the file type |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | The time the document was created |
| <a id="property-documentfamilyid"></a> `documentFamilyId?` | `number` \| `null` | The id of the document family this document belongs to |
| <a id="property-documentid"></a> `documentId` | `string` | The id of the document |
| <a id="property-documentname"></a> `documentName` | `string` | The name of the document |
| <a id="property-documentversionid"></a> `documentVersionId` | `number` | The id of the document version |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | The file type of the document |
| <a id="property-updatedat"></a> `updatedAt?` | `string` \| `null` | The time the document instance / document BOM was updated |
