# Type Alias: CreateEntityMentionResponse

> **CreateEntityMentionResponse** = \{ `created_at`: `string`; `entity_id`: `string`; `entity_type`: `string`; `id`: `string`; `source_entity_id`: `string`; `source_entity_type`: `string`; `user_id?`: `string` \| `null`; \}

Response body for `POST /channels/mentions`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | Created timestamp. |
| <a id="property-entity_id"></a> `entity_id` | `string` | Id of the mentioned entity. |
| <a id="property-entity_type"></a> `entity_type` | `string` | Type of the mentioned entity. |
| <a id="property-id"></a> `id` | `string` | Mention id. |
| <a id="property-source_entity_id"></a> `source_entity_id` | `string` | Id of the entity that owns the mention. |
| <a id="property-source_entity_type"></a> `source_entity_type` | `string` | Type of the entity that owns the mention. |
| <a id="property-user_id"></a> `user_id?` | `string` \| `null` | User who recorded the mention. |
