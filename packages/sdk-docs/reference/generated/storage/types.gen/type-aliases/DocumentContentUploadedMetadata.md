# Type Alias: DocumentContentUploadedMetadata

> **DocumentContentUploadedMetadata** = \{ `document_id`: `string`; `document_version_id?`: `string` \| `null`; `file_type`: [`FileType`](FileType.md); `owner`: `string`; \}

Metadata for [`DocumentTopicEvent::ContentUploaded`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the document whose stored bytes changed. |
| <a id="property-document_version_id"></a> `document_version_id?` | `string` \| `null` | Version written, or the converted-file marker; `None` for unversioned writes (mirrors `SearchExtractorMessage::document_version_id`). |
| <a id="property-file_type"></a> `file_type` | [`FileType`](FileType.md) | File type of the uploaded object (may differ from the document's own type, e.g. `pdf` for the converted rendition of a docx). |
| <a id="property-owner"></a> `owner` | `string` | The owner of the document (used by the extractor to resolve S3 keys). |
