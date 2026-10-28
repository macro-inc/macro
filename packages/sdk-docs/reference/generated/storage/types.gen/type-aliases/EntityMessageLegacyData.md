# Type Alias: EntityMessageLegacyData

> **EntityMessageLegacyData** = \{ `body?`: `never`; `path`: \{ `legacy_id`: `number`; `parent_id`: `string`; `parent_type`: `string`; \}; `query?`: \{ `thread?`: `boolean`; \}; `url`: `"/messages/{parent_type}/{parent_id}/legacy/{legacy_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `legacy_id`: `number`; `parent_id`: `string`; `parent_type`: `string`; \} | - |
| `path.legacy_id` | `number` | - |
| `path.parent_id` | `string` | - |
| `path.parent_type` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `thread?`: `boolean`; \} | - |
| `query.thread?` | `boolean` | Resolve a thread id instead of a comment id. |
| <a id="property-url"></a> `url` | `"/messages/{parent_type}/{parent_id}/legacy/{legacy_id}"` | - |
