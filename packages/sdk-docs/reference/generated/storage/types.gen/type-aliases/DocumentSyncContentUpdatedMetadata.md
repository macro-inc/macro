# Type Alias: DocumentSyncContentUpdatedMetadata

> **DocumentSyncContentUpdatedMetadata** = \{ `actor?`: `string` \| `null`; `document_id`: `string`; `document_version_id?`: `string` \| `null`; `editors?`: [`DocumentSyncEditor`](DocumentSyncEditor.md)[]; `file_type`: [`FileType`](FileType.md); `on_behalf_of?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); \}

Metadata for [`DocumentTopicEvent::SyncContentUpdated`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor?` | `string` \| `null` | Legacy single-editor attribution; newer Sync callers send `editors`. |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the live-collab document whose content changed. |
| <a id="property-document_version_id"></a> `document_version_id?` | `string` \| `null` | Version marker for the sync snapshot, when the caller supplies one. |
| <a id="property-editors"></a> `editors?` | [`DocumentSyncEditor`](DocumentSyncEditor.md)[] | Distinct editors since the preceding snapshot notification. |
| <a id="property-file_type"></a> `file_type` | [`FileType`](FileType.md) | File type of the sync document, resolved by the document backend. |
| <a id="property-on_behalf_of"></a> `on_behalf_of?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
