# Type Alias: DeleteSavedViewDefinitionData

> **DeleteSavedViewDefinitionData** = \{ `body?`: `never`; `path`: \{ `saved_view_id`: `string`; \}; `query`: \{ `expectedRevision`: `number`; \}; `url`: `"/saved_views/definitions/{saved_view_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `saved_view_id`: `string`; \} | - |
| `path.saved_view_id` | `string` | The saved view to delete |
| <a id="property-query"></a> `query` | \{ `expectedRevision`: `number`; \} | - |
| `query.expectedRevision` | `number` | Revision that must still be current when the deletion commits. |
| <a id="property-url"></a> `url` | `"/saved_views/definitions/{saved_view_id}"` | - |
