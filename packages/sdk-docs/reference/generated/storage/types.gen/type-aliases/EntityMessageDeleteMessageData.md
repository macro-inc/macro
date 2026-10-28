# Type Alias: EntityMessageDeleteMessageData

> **EntityMessageDeleteMessageData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; `parent_id`: `string`; `parent_type`: `string`; \}; `query?`: \{ `nonce?`: `string` \| `null`; \}; `url`: `"/messages/{parent_type}/{parent_id}/items/{id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; `parent_id`: `string`; `parent_type`: `string`; \} | - |
| `path.id` | `string` | - |
| `path.parent_id` | `string` | - |
| `path.parent_type` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `nonce?`: `string` \| `null`; \} | - |
| `query.nonce?` | `string` \| `null` | Client nonce. |
| <a id="property-url"></a> `url` | `"/messages/{parent_type}/{parent_id}/items/{id}"` | - |
