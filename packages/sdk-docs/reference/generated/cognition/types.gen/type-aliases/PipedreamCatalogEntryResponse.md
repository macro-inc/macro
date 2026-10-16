# Type Alias: PipedreamCatalogEntryResponse

> **PipedreamCatalogEntryResponse** = \{ `app_slug`: `string`; `description?`: `string` \| `null`; `display_name`: `string`; `icon_url?`: `string` \| `null`; \}

One connectable app in the catalog.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_slug"></a> `app_slug` | `string` | Pipedream app name slug — pass this to the connect flow. |
| <a id="property-description"></a> `description?` | `string` \| `null` | One-line description of the app. |
| <a id="property-display_name"></a> `display_name` | `string` | Human-readable name to display. |
| <a id="property-icon_url"></a> `icon_url?` | `string` \| `null` | URL of the app's icon, when available. |
