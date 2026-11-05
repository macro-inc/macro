# Type Alias: ReorderSavedViewDefinitionsRequest

> **ReorderSavedViewDefinitionsRequest** = \{ `ids`: `string`[]; `kind`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-ids"></a> `ids` | `string`[] | Visible definitions of that kind in their new order, at most 200; definitions left out follow them by creation time. |
| <a id="property-kind"></a> `kind` | `string` | Consumer kind whose order is replaced, such as `email`. |
