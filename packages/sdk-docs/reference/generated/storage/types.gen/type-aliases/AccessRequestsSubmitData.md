# Type Alias: AccessRequestsSubmitData

> **AccessRequestsSubmitData** = \{ `body`: [`RequestAccess`](RequestAccess.md); `path`: \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); \}; `query?`: `never`; `url`: `"/entities/{entity_type}/{entity_id}/access-requests/mine"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`RequestAccess`](RequestAccess.md) |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); \} |
| `path.entity_id` | `string` |
| `path.entity_type` | [`ShareEntityType`](ShareEntityType.md) |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/entities/{entity_type}/{entity_id}/access-requests/mine"` |
