# Type Alias: ViewQuery

> **ViewQuery** = \{ `filter`: `null` \| [`FilterGroup`](FilterGroup.md); `sort?`: [`SortKey`](SortKey.md)[]; \}

Which rows of the table a view shows, and in what order: a filter and a
sort, nothing that joins, groups or reshapes rows.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-filter"></a> `filter` | `null` \| [`FilterGroup`](FilterGroup.md) | - |
| <a id="property-sort"></a> `sort?` | [`SortKey`](SortKey.md)[] | The sort keys, first key first. Rows the keys leave tied keep the table's own order; with no keys, the table's order is the view's. |
