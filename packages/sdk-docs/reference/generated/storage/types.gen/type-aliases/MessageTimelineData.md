# Type Alias: MessageTimelineData

> **MessageTimelineData** = \{ `body?`: `never`; `path`: \{ `parent_id`: `string`; `parent_type`: `string`; \}; `query?`: \{ `selection?`: `string` \| `null`; \}; `url`: `"/messages/{parent_type}/{parent_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `parent_id`: `string`; `parent_type`: `string`; \} | - |
| `path.parent_id` | `string` | - |
| `path.parent_type` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `selection?`: `string` \| `null`; \} | - |
| `query.selection?` | `string` \| `null` | Serialized MessageTimelineQuery; absent selects the latest roots. |
| <a id="property-url"></a> `url` | `"/messages/{parent_type}/{parent_id}"` | - |
