# Type Alias: CreateDocumentRequest

> **CreateDocumentRequest** = \{ `branchedFromId?`: `string` \| `null`; `branchedFromVersionId?`: `number` \| `null`; `createdAt?`: `string` \| `null`; `documentFamilyId?`: `number` \| `null`; `documentName`: `string`; `emailAttachmentId?`: `string` \| `null`; `fileType?`: `string` \| `null`; `id?`: `string` \| `null`; `isTask?`: `boolean`; `jobId?`: `string` \| `null`; `mimeType?`: `string` \| `null`; `projectId?`: `string` \| `null`; `sha`: `string`; `skipHistory?`: `boolean`; `teamId?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-branchedfromid"></a> `branchedFromId?` | `string` \| `null` | The document id if the document is being branched. |
| <a id="property-branchedfromversionid"></a> `branchedFromVersionId?` | `number` \| `null` | The version id if the document is being branched. |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | Optional time to set the document's created_at to. Set when backfilling email attachments. |
| <a id="property-documentfamilyid"></a> `documentFamilyId?` | `number` \| `null` | The document family id if the document is being branched. |
| <a id="property-documentname"></a> `documentName` | `string` | The name of the document without extension. |
| <a id="property-emailattachmentid"></a> `emailAttachmentId?` | `string` \| `null` | Internal only field that links the document created to the specified email attachment by creating a row in the document_email table. |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | Optional file type of the document. |
| <a id="property-id"></a> `id?` | `string` \| `null` | The id of the document in the database |
| <a id="property-istask"></a> `isTask?` | `boolean` | Whether the document is a task. This is only applicable for md documents and the request will fail if the file type is not md. |
| <a id="property-jobid"></a> `jobId?` | `string` \| `null` | Optional job id to be used to track an upload job for the newly created document. Will need to have a corresponding job initiated for the file beforehand. |
| <a id="property-mimetype"></a> `mimeType?` | `string` \| `null` | The content type of the document (currently only used for logging matches against file type). |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | - |
| <a id="property-sha"></a> `sha` | `string` | The sha of the document. |
| <a id="property-skiphistory"></a> `skipHistory?` | `boolean` | Whether to add a viewed_at record for this document upon creation. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Team to assign the task number within when creating a task document. If omitted, the service may infer it only when the creator belongs to exactly one team. |
