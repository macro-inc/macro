# Type Alias: DocumentCreatedMetadata

> **DocumentCreatedMetadata** = \{ `actor?`: `string` \| `null`; `created_at?`: `string` \| `null`; `document_id`: `string`; `document_name`: `string`; `file_type?`: `null` \| [`FileType`](FileType.md); `on_behalf_of?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `owner`: `string`; `project_id?`: `string` \| `null`; `sub_type?`: `null` \| [`DocumentSubType`](DocumentSubType.md); \}

Metadata for [`DocumentTopicEvent::Created`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor?` | `string` \| `null` | Who mechanically created the document. Absent on events published before attribution: ingest derives a user/bot actor from [`Self::owner`]. Team owners fall back to [`Self::on_behalf_of`], then the system bot. |
| <a id="property-created_at"></a> `created_at?` | `string` \| `null` | Creation timestamp reported by the repository. |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the created document. |
| <a id="property-document_name"></a> `document_name` | `string` | The document name, with any file extension stripped. |
| <a id="property-file_type"></a> `file_type?` | `null` \| [`FileType`](FileType.md) | - |
| <a id="property-on_behalf_of"></a> `on_behalf_of?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-owner"></a> `owner` | `string` | The principal who owns the document. |
| <a id="property-project_id"></a> `project_id?` | `string` \| `null` | Project the document was created in, when any. |
| <a id="property-sub_type"></a> `sub_type?` | `null` \| [`DocumentSubType`](DocumentSubType.md) | - |
