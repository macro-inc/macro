# Type Alias: ListSavedViewDefinitionsData

> **ListSavedViewDefinitionsData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `after?`: `string`; `first?`: `number`; `kind?`: `string`; \}; `url`: `"/saved_views/definitions"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `after?`: `string`; `first?`: `number`; `kind?`: `string`; \} | - |
| `query.after?` | `string` | `nextCursor` from the previous page. |
| `query.first?` | `number` | Page size, 1 to 50; defaults to 25. |
| `query.kind?` | `string` | Only definitions of this consumer kind, such as `email`. |
| <a id="property-url"></a> `url` | `"/saved_views/definitions"` | - |
