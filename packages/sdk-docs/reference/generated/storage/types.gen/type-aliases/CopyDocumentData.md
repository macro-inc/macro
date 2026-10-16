# Type Alias: CopyDocumentData

> **CopyDocumentData** = \{ `body`: [`CopyDocumentRequest`](CopyDocumentRequest.md); `path`: \{ `document_id`: `string`; \}; `query?`: \{ `version_id?`: `number`; \}; `url`: `"/documents/{document_id}/copy"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`CopyDocumentRequest`](CopyDocumentRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `document_id`: `string`; \} | - |
| `path.document_id` | `string` | Document ID |
| <a id="property-query"></a> `query?` | \{ `version_id?`: `number`; \} | - |
| `query.version_id?` | `number` | The version id of the document to copy. Defaults to copying the latest version of the document. |
| <a id="property-url"></a> `url` | `"/documents/{document_id}/copy"` | - |
