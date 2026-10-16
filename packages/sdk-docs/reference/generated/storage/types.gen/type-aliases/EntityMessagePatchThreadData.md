# Type Alias: EntityMessagePatchThreadData

> **EntityMessagePatchThreadData** = \{ `body`: [`ThreadPatch`](ThreadPatch.md); `path`: \{ `id`: `string`; `parent_id`: `string`; `parent_type`: `string`; \}; `query?`: `never`; `url`: `"/messages/{parent_type}/{parent_id}/threads/{id}"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`ThreadPatch`](ThreadPatch.md) |
| <a id="property-path"></a> `path` | \{ `id`: `string`; `parent_id`: `string`; `parent_type`: `string`; \} |
| `path.id` | `string` |
| `path.parent_id` | `string` |
| `path.parent_type` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/messages/{parent_type}/{parent_id}/threads/{id}"` |
