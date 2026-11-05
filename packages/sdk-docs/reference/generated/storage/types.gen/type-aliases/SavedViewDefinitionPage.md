# Type Alias: SavedViewDefinitionPage

> **SavedViewDefinitionPage** = \{ `nextCursor?`: `string` \| `null`; `views`: [`SavedViewDefinition`](SavedViewDefinition.md)[]; \}

A page in the viewer's own order, then by creation time and ID.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-nextcursor"></a> `nextCursor?` | `string` \| `null` | Opaque cursor for the next page, absent when the listing is complete. |
| <a id="property-views"></a> `views` | [`SavedViewDefinition`](SavedViewDefinition.md)[] | Definitions the viewer can currently access. |
