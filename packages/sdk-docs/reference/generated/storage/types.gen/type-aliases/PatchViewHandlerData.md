# Type Alias: PatchViewHandlerData

> **PatchViewHandlerData** = \{ `body`: [`ViewPatch`](ViewPatch.md); `path`: \{ `saved_view_id`: `string`; \}; `query?`: `never`; `url`: `"/saved_views/{saved_view_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`ViewPatch`](ViewPatch.md) | - |
| <a id="property-path"></a> `path` | \{ `saved_view_id`: `string`; \} | - |
| `path.saved_view_id` | `string` | The id of the saved view to patch |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/saved_views/{saved_view_id}"` | - |
