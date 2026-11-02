# Type Alias: GroupedPageParams

> **GroupedPageParams** = \{ `group_by`: [`ApiGroupByField`](ApiGroupByField.md); `group_key`: `string`; `limit?`: `number` \| `null`; `sort_direction?`: `null` \| [`SoupApiSortDirection`](SoupApiSortDirection.md); `sort_method?`: `null` \| [`GroupedSoupSort`](GroupedSoupSort.md); `sort_property_definition_id?`: `string` \| `null`; \}

Parameters for fetching one page within a specific group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-group_by"></a> `group_by` | [`ApiGroupByField`](ApiGroupByField.md) | Field to group results by (required). |
| <a id="property-group_key"></a> `group_key` | `string` | Group key to fetch. |
| <a id="property-limit"></a> `limit?` | `number` \| `null` | Limit the number of items returned. Defaults to 20. Max 500. |
| <a id="property-sort_direction"></a> `sort_direction?` | `null` \| [`SoupApiSortDirection`](SoupApiSortDirection.md) | - |
| <a id="property-sort_method"></a> `sort_method?` | `null` \| [`GroupedSoupSort`](GroupedSoupSort.md) | - |
| <a id="property-sort_property_definition_id"></a> `sort_property_definition_id?` | `string` \| `null` | Property definition selected for numeric property sorting. |
