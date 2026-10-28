# Type Alias: GetEntityPropertiesData

> **GetEntityPropertiesData** = \{ `body?`: `never`; `path`: \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); \}; `query?`: \{ `include_metadata?`: `boolean`; \}; `url`: `"/properties/entities/{entity_type}/{entity_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); \} | - |
| `path.entity_id` | `string` | Entity ID |
| `path.entity_type` | [`PropertyTargetEntityType`](PropertyTargetEntityType.md) | Canonical entity type; tasks use DOCUMENT |
| <a id="property-query"></a> `query?` | \{ `include_metadata?`: `boolean`; \} | - |
| `query.include_metadata?` | `boolean` | Whether to include property metadata (default: false) |
| <a id="property-url"></a> `url` | `"/properties/entities/{entity_type}/{entity_id}"` | - |
