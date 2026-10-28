# Type Alias: DocumentDeletedMetadata

> **DocumentDeletedMetadata** = \{ `actor?`: `string` \| `null`; `actor_user_id?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `document_id`: `string`; `on_behalf_of?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `project_id?`: `string` \| `null`; `sub_type?`: `null` \| [`DocumentSubType`](DocumentSubType.md); \}

Metadata for [`DocumentTopicEvent::Deleted`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor?` | `string` \| `null` | Who mechanically deleted the document. Absent on events published before attribution, and on user-receipt writes (ingest then uses [`Self::actor_user_id`]). |
| <a id="property-actor_user_id"></a> `actor_user_id?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the deleted document. |
| <a id="property-on_behalf_of"></a> `on_behalf_of?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-project_id"></a> `project_id?` | `string` \| `null` | Project the document belonged to, when any. |
| <a id="property-sub_type"></a> `sub_type?` | `null` \| [`DocumentSubType`](DocumentSubType.md) | - |
