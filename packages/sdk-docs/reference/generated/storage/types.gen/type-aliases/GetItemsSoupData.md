# Type Alias: GetItemsSoupData

> **GetItemsSoupData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `cursor?`: `string`; `expand?`: `boolean`; `limit?`: `number`; `sort_direction?`: [`SoupApiSortDirection`](SoupApiSortDirection.md); `sort_method?`: [`SoupApiSort`](SoupApiSort.md); `sort_property_definition_id?`: `string`; \}; `url`: `"/items/soup"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `expand?`: `boolean`; `limit?`: `number`; `sort_direction?`: [`SoupApiSortDirection`](SoupApiSortDirection.md); `sort_method?`: [`SoupApiSort`](SoupApiSort.md); `sort_property_definition_id?`: `string`; \} | - |
| `query.cursor?` | `string` | Base64 encoded cursor value. |
| `query.expand?` | `boolean` | Whether to expand projects. Defaults to true. |
| `query.limit?` | `number` | Limit the number of items returned. Defaults to 20. Max 500. |
| `query.sort_direction?` | [`SoupApiSortDirection`](SoupApiSortDirection.md) | Sort direction. Options are asc, desc. Defaults to desc. Timestamp sorts require this parameter again on each page. Property cursors preserve their direction and always put missing values last. Ascending frecency, touched-by-me, and notified-at sorts are unsupported. |
| `query.sort_method?` | [`SoupApiSort`](SoupApiSort.md) | Sort method. Property ordering supports DATE, NUMBER, BOOLEAN, SELECT and TAG. Missing definitions, unsupported types, and mismatched values sort as missing. Flat property sorts omit calendar events, email, channels, calls, companies, and agent sessions. Defaults to viewed_at. |
| `query.sort_property_definition_id?` | `string` | Property definition selected for numeric property sorting. |
| <a id="property-url"></a> `url` | `"/items/soup"` | - |
