# Type Alias: DocumentUpdatedMetadata

> **DocumentUpdatedMetadata** = \{ `actor?`: `string` \| `null`; `actor_user_id?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `document_id`: `string`; `document_name?`: `string` \| `null`; `file_type?`: `null` \| [`FileTypeUpdate`](FileTypeUpdate.md); `on_behalf_of?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `owner`: `string`; `previous_project_id?`: `string` \| `null`; `project_id?`: `string` \| `null`; `share_permission_updated`: `boolean`; \}

Metadata for [`DocumentTopicEvent::Updated`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor?` | `string` \| `null` | Who mechanically updated the document. Absent on events published before attribution, and on user-receipt writes (ingest then uses [`Self::actor_user_id`]). |
| <a id="property-actor_user_id"></a> `actor_user_id?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the updated document. |
| <a id="property-document_name"></a> `document_name?` | `string` \| `null` | New (cleaned) document name; `None` when unchanged. |
| <a id="property-file_type"></a> `file_type?` | `null` \| [`FileTypeUpdate`](FileTypeUpdate.md) | - |
| <a id="property-on_behalf_of"></a> `on_behalf_of?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-owner"></a> `owner` | `string` | The owner of the document. |
| <a id="property-previous_project_id"></a> `previous_project_id?` | `string` \| `null` | Project id before the update. |
| <a id="property-project_id"></a> `project_id?` | `string` \| `null` | New project id; `None` when unchanged, `Some("")` when removed from its project (mirrors the edit repo args semantics). |
| <a id="property-share_permission_updated"></a> `share_permission_updated` | `boolean` | Whether share permissions were updated. |
