# Type Alias: StoredConnectionEntity

> **StoredConnectionEntity** = \{ `connection_id`: `string`; `created_at`: `number`; `entity_id`: `string`; `entity_type`: [`EntityType`](EntityType.md); `last_ping?`: `number` \| `null`; `PK`: `string`; `SK`: `string`; `user_id`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-connection_id"></a> `connection_id` | `string` | id of the connection |
| <a id="property-created_at"></a> `created_at` | `number` | timestamp when the connection was initiated |
| <a id="property-entity_id"></a> `entity_id` | `string` | id of the entity |
| <a id="property-entity_type"></a> `entity_type` | [`EntityType`](EntityType.md) | type of the entity |
| <a id="property-last_ping"></a> `last_ping?` | `number` \| `null` | the timestamp of the last ping |
| <a id="property-pk"></a> `PK` | `string` | - |
| <a id="property-sk"></a> `SK` | `string` | - |
| <a id="property-user_id"></a> `user_id` | `string` | user id to whom the conneciton belongs to |
