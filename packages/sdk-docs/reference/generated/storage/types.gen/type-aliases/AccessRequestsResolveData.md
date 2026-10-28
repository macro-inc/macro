# Type Alias: AccessRequestsResolveData

> **AccessRequestsResolveData** = \{ `body`: [`ResolveRequest`](ResolveRequest.md); `path`: \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); `request_id`: `string`; \}; `query?`: `never`; `url`: `"/entities/{entity_type}/{entity_id}/access-requests/{request_id}/resolve"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`ResolveRequest`](ResolveRequest.md) |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); `request_id`: `string`; \} |
| `path.entity_id` | `string` |
| `path.entity_type` | [`ShareEntityType`](ShareEntityType.md) |
| `path.request_id` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/entities/{entity_type}/{entity_id}/access-requests/{request_id}/resolve"` |
