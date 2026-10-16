# Type Alias: AccessRequestsSetDirectData

> **AccessRequestsSetDirectData** = \{ `body`: [`SetDirectAccess`](SetDirectAccess.md); `path`: \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); `user_id`: `string`; \}; `query?`: `never`; `url`: `"/entities/{entity_type}/{entity_id}/direct-access/{user_id}"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`SetDirectAccess`](SetDirectAccess.md) |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`ShareEntityType`](ShareEntityType.md); `user_id`: `string`; \} |
| `path.entity_id` | `string` |
| `path.entity_type` | [`ShareEntityType`](ShareEntityType.md) |
| `path.user_id` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/entities/{entity_type}/{entity_id}/direct-access/{user_id}"` |
