# Interface: WebSearchOptions

Limits for a web search.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-domains"></a> `domains?` | `string`[] | Only return pages from these domains, such as `['docs.rs']`; subdomains match too. At most 20. Omit to search the whole web. |
| <a id="property-maxresults"></a> `maxResults?` | `number` | Return at most this many results, from 1 to 30 (the default). |
