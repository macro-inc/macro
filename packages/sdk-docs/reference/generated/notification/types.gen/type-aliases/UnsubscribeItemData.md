# Type Alias: UnsubscribeItemData

> **UnsubscribeItemData** = \{ `body?`: `never`; `path`: \{ `item_id`: `string`; `item_type`: [`EntityType`](EntityType.md); \}; `query?`: \{ `snoozed_until?`: `string` \| `null`; \}; `url`: `"/unsubscribe/item/{item_type}/{item_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `item_id`: `string`; `item_type`: [`EntityType`](EntityType.md); \} | - |
| `path.item_id` | `string` | - |
| `path.item_type` | [`EntityType`](EntityType.md) | - |
| <a id="property-query"></a> `query?` | \{ `snoozed_until?`: `string` \| `null`; \} | - |
| `query.snoozed_until?` | `string` \| `null` | A future resume time. Omit to mute indefinitely. |
| <a id="property-url"></a> `url` | `"/unsubscribe/item/{item_type}/{item_id}"` | - |
