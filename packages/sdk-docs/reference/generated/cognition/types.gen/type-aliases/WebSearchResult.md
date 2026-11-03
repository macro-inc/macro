# Type Alias: WebSearchResult

> **WebSearchResult** = \{ `pageAge?`: `string` \| `null`; `title`: `string`; `url`: `string`; \}

One page found by a web search.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-pageage"></a> `pageAge?` | `string` \| `null` | How old the page is, as free text from the search index ("April 30, 2025" or "3 days ago"), when known. Not a parseable date. |
| <a id="property-title"></a> `title` | `string` | The page title. |
| <a id="property-url"></a> `url` | `string` | The page URL. |
