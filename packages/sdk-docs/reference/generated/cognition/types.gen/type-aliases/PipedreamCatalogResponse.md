# Type Alias: PipedreamCatalogResponse

> **PipedreamCatalogResponse** = \{ `next_cursor?`: `string` \| `null`; `servers`: [`PipedreamCatalogEntryResponse`](PipedreamCatalogEntryResponse.md)[]; \}

A page of the connector catalog.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | Cursor for the next page. Absent on the last page. |
| <a id="property-servers"></a> `servers` | [`PipedreamCatalogEntryResponse`](PipedreamCatalogEntryResponse.md)[] | Catalog entries in display order (most popular first). |
