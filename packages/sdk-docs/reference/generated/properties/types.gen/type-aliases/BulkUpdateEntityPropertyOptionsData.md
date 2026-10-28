# Type Alias: BulkUpdateEntityPropertyOptionsData

> **BulkUpdateEntityPropertyOptionsData** = \{ `body`: [`BulkUpdateEntityPropertyOptionsRequest`](BulkUpdateEntityPropertyOptionsRequest.md); `path`: \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); \}; `query?`: `never`; `url`: `"/properties/entities/{entity_type}/{entity_id}/options/bulk"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`BulkUpdateEntityPropertyOptionsRequest`](BulkUpdateEntityPropertyOptionsRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); \} | - |
| `path.entity_id` | `string` | Entity ID |
| `path.entity_type` | [`PropertyTargetEntityType`](PropertyTargetEntityType.md) | Canonical entity type; tasks use DOCUMENT |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/properties/entities/{entity_type}/{entity_id}/options/bulk"` | - |
