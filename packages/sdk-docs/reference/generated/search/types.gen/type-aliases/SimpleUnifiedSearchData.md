# Type Alias: SimpleUnifiedSearchData

> **SimpleUnifiedSearchData** = \{ `body`: [`UnifiedSearchRequest`](UnifiedSearchRequest.md); `path?`: `never`; `query`: \{ `cursor?`: `string`; `page_size`: `number`; \}; `url`: `"/search/simple"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`UnifiedSearchRequest`](UnifiedSearchRequest.md) | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `cursor?`: `string`; `page_size`: `number`; \} | - |
| `query.cursor?` | `string` | Base64 encoded cursor for pagination. |
| `query.page_size` | `number` | The page size. Defaults to 10. |
| <a id="property-url"></a> `url` | `"/search/simple"` | - |
