# Type Alias: GetItemsSoupData

> **GetItemsSoupData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `cursor?`: `string`; `expand?`: `boolean`; `limit?`: `number`; `sort_direction?`: [`SoupApiSortDirection`](SoupApiSortDirection.md); `sort_method?`: [`SoupApiSort`](SoupApiSort.md); \}; `url`: `"/items/soup"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `expand?`: `boolean`; `limit?`: `number`; `sort_direction?`: [`SoupApiSortDirection`](SoupApiSortDirection.md); `sort_method?`: [`SoupApiSort`](SoupApiSort.md); \} | - |
| `query.cursor?` | `string` | Base64 encoded cursor value. |
| `query.expand?` | `boolean` | Whether to expand projects. Defaults to true. |
| `query.limit?` | `number` | Limit the number of items returned. Defaults to 20. Max 500. |
| `query.sort_direction?` | [`SoupApiSortDirection`](SoupApiSortDirection.md) | Sort direction. Options are asc, desc. Defaults to desc. Re-send this with every page: it is not carried in the cursor. Applies to the timestamp sort methods only. `asc` combined with `frecency` is rejected rather than ignored: frecency pages are ordered by relevance score and the cursor comparison assumes descending, so there is no ascending frecency order to give. |
| `query.sort_method?` | [`SoupApiSort`](SoupApiSort.md) | Sort method. Includes timestamp sorts, relevance sorts, and due_date_earliest/due_date_latest for tasks. Defaults to viewed_at. |
| <a id="property-url"></a> `url` | `"/items/soup"` | - |
