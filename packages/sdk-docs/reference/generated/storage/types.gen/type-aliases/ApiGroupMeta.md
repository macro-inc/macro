# Type Alias: ApiGroupMeta

> **ApiGroupMeta** = \{ `display_order?`: `number` \| `null`; `item_ids`: `string`[]; `key`: `string`; `label`: `string`; `next_cursor?`: `string` \| `null`; `total_count`: `number`; \}

API representation of group metadata.

Items belonging to this group are referenced by `item_ids`, each of which
looks up an entry in `GroupedSoupPage.items` (a normalized pool).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-display_order"></a> `display_order?` | `number` \| `null` | Display order for sorting groups (lower = first) |
| <a id="property-item_ids"></a> `item_ids` | `string`[] | Ordered ids of items in this group for the current page. Each id keys into `GroupedSoupPage.items`. |
| <a id="property-key"></a> `key` | `string` | Group key - format depends on group_by field |
| <a id="property-label"></a> `label` | `string` | Human-readable label for the group |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | Cursor to load more items specifically from this group |
| <a id="property-total_count"></a> `total_count` | `number` | Total count of items in this group across all pages |
