# Type Alias: GetUnfurlResponse

> **GetUnfurlResponse** = \{ `description?`: `string` \| `null`; `favicon_url?`: `string` \| `null`; `image_url?`: `string` \| `null`; `title`: `string`; `url`: `string`; \}

Unfurl response for a single URL: the URL itself plus any metadata that
was extracted from the page's `<head>` (title, description, image,
favicon).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-description"></a> `description?` | `string` \| `null` | The page description (from `og:description`), if any. |
| <a id="property-favicon_url"></a> `favicon_url?` | `string` \| `null` | The page's favicon URL, if any. |
| <a id="property-image_url"></a> `image_url?` | `string` \| `null` | The page's preview image URL (from `og:image`), if any. |
| <a id="property-title"></a> `title` | `string` | The page title (from custom URL parser, Open Graph, or `<title>`). |
| <a id="property-url"></a> `url` | `string` | The URL that was unfurled. |
