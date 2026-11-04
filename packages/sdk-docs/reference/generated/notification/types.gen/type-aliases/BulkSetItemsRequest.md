# Type Alias: BulkSetItemsRequest

> **BulkSetItemsRequest** = \{ `items`: [`BulkItem`](BulkItem.md)[]; `snoozed_until?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-items"></a> `items` | [`BulkItem`](BulkItem.md)[] | - |
| <a id="property-snoozed_until"></a> `snoozed_until?` | `string` \| `null` | A future resume time. Omit to mute indefinitely. |
