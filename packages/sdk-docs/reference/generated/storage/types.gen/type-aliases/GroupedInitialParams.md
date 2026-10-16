# Type Alias: GroupedInitialParams

> **GroupedInitialParams** = \{ `group_by`: [`ApiGroupByField`](ApiGroupByField.md); `per_group_limit?`: `number` \| `null`; `sort_method?`: `null` \| [`GroupedSoupSort`](GroupedSoupSort.md); \}

Parameters for the initial grouped soup query.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-group_by"></a> `group_by` | [`ApiGroupByField`](ApiGroupByField.md) | Field to group results by (required). |
| <a id="property-per_group_limit"></a> `per_group_limit?` | `number` \| `null` | Limit the number of items returned per group. Defaults to 20. Max 500. |
| <a id="property-sort_method"></a> `sort_method?` | `null` \| [`GroupedSoupSort`](GroupedSoupSort.md) | - |
