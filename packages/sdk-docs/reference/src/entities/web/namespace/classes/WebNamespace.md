# Class: WebNamespace

Web search, charged to the acting user's AI allowance.

## Constructors

### Constructor

> **new WebNamespace**(`client`): `WebNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`WebNamespace`

## Methods

### search()

> **search**(`query`, `options?`): `Promise`\<[`WebSearchResult`](../../../../../generated/cognition/types.gen/type-aliases/WebSearchResult.md)[]\>

Search the web and return the pages found (title, url, and pageAge when
known), most relevant first. pageAge is free text ("April 30, 2025" or
"3 days ago"), not a parseable date. Results carry no page text: read a page's
preview with `macro.unfurls.get(url)`. Takes a few seconds, so run
independent searches with `Promise.all`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `options?` | [`WebSearchOptions`](../interfaces/WebSearchOptions.md) |

#### Returns

`Promise`\<[`WebSearchResult`](../../../../../generated/cognition/types.gen/type-aliases/WebSearchResult.md)[]\>

#### Example

```ts
const pages = await macro.web.search('tokio 1.40 release notes', {
  domains: ['tokio.rs', 'github.com'],
  maxResults: 5,
});
return pages.map((page) => `${page.title}: ${page.url}`);
```
