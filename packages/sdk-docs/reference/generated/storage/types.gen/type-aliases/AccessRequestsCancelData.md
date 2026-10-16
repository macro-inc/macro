# Type Alias: AccessRequestsCancelData

> **AccessRequestsCancelData** = \{ `body?`: `never`; `path`: \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); \}; `query`: \{ `revision`: `number`; \}; `url`: `"/entities/{entity_type}/{entity_id}/access-requests/mine"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); \} | - |
| `path.entity_id` | `string` | - |
| `path.entity_type` | [`ShareEntityType`](ShareEntityType.md) | - |
| <a id="property-query"></a> `query` | \{ `revision`: `number`; \} | - |
| `query.revision` | `number` | Last observed request revision. |
| <a id="property-url"></a> `url` | `"/entities/{entity_type}/{entity_id}/access-requests/mine"` | - |
