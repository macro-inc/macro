# Type Alias: BrowsePipedreamMcpCatalogData

> **BrowsePipedreamMcpCatalogData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `cursor?`: `string`; `limit?`: `number`; `search?`: `string`; \}; `url`: `"/pipedream/mcp/catalog"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `limit?`: `number`; `search?`: `string`; \} | - |
| `query.cursor?` | `string` | Opaque pagination cursor from a previous response. |
| `query.limit?` | `number` | Page size (default 20, max 50). |
| `query.search?` | `string` | Search query to filter apps by name. Omit to browse. |
| <a id="property-url"></a> `url` | `"/pipedream/mcp/catalog"` | - |
