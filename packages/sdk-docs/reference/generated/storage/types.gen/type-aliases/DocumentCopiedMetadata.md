# Type Alias: DocumentCopiedMetadata

> **DocumentCopiedMetadata** = \{ `actor?`: `string` \| `null`; `document_id`: `string`; `document_name`: `string`; `file_type?`: `null` \| [`FileType`](FileType.md); `on_behalf_of?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `owner`: `string`; `project_id?`: `string` \| `null`; `source_document_id`: `string`; `source_version_id?`: `number` \| `null`; `sub_type?`: `null` \| [`DocumentSubType`](DocumentSubType.md); \}

Metadata for [`DocumentTopicEvent::Copied`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor?` | `string` \| `null` | Who mechanically created the copy. |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the newly created copy. |
| <a id="property-document_name"></a> `document_name` | `string` | The name of the new document. |
| <a id="property-file_type"></a> `file_type?` | `null` \| [`FileType`](FileType.md) | - |
| <a id="property-on_behalf_of"></a> `on_behalf_of?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-owner"></a> `owner` | `string` | The principal who owns the new copy. |
| <a id="property-project_id"></a> `project_id?` | `string` \| `null` | Project the copy belongs to, when any. |
| <a id="property-source_document_id"></a> `source_document_id` | `string` | The id of the document that was copied. |
| <a id="property-source_version_id"></a> `source_version_id?` | `number` \| `null` | The specific source version copied, when requested. |
| <a id="property-sub_type"></a> `sub_type?` | `null` \| [`DocumentSubType`](DocumentSubType.md) | - |
