# Type Alias: WebSearchRequest

> **WebSearchRequest** = \{ `domains?`: `string`[]; `maxResults?`: `number` \| `null`; `query`: `string`; \}

What to search the web for.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-domains"></a> `domains?` | `string`[] | Only return pages from these domains, such as `docs.rs`; omit to search the whole web. At most 20. |
| <a id="property-maxresults"></a> `maxResults?` | `number` \| `null` | Return at most this many results, from 1 to 30 (the default). |
| <a id="property-query"></a> `query` | `string` | The search query, up to 400 characters. |
