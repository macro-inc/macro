# Type Alias: GroupedSoupGroupPage

> **GroupedSoupGroupPage** = \{ `group`: [`ApiGroupMeta`](ApiGroupMeta.md); `items`: \{\[`key`: `string`\]: [`SoupApiItem`](SoupApiItem.md); \}; \}

Response for fetching a page within one group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-group"></a> `group` | [`ApiGroupMeta`](ApiGroupMeta.md) | Metadata and item membership for the requested group page. |
| <a id="property-items"></a> `items` | \{\[`key`: `string`\]: [`SoupApiItem`](SoupApiItem.md); \} | Items in this page, keyed by id. Ordering lives in `group.item_ids`. |
