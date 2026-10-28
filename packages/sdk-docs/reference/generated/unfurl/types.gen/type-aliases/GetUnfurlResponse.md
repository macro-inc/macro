# Type Alias: GetUnfurlResponse

> **GetUnfurlResponse** = \{ `description?`: `string` \| `null`; `embed_type?`: [`UnfurlEmbedType`](UnfurlEmbedType.md); `embed_url?`: `string` \| `null`; `favicon_url?`: `string` \| `null`; `image_url?`: `string` \| `null`; `title`: `string`; `url`: `string`; \}

Unfurl response for a single URL: the URL itself plus any metadata that
was extracted from the page's `<head>` (title, description, image,
favicon).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-description"></a> `description?` | `string` \| `null` | The page description (from `og:description`), if any. |
| <a id="property-embed_type"></a> `embed_type?` | [`UnfurlEmbedType`](UnfurlEmbedType.md) | The type of embeddable content, if the URL supports iframe embedding. |
| <a id="property-embed_url"></a> `embed_url?` | `string` \| `null` | The iframe-embeddable URL for services like Loom or Supercut. |
| <a id="property-favicon_url"></a> `favicon_url?` | `string` \| `null` | The page's favicon URL, if any. |
| <a id="property-image_url"></a> `image_url?` | `string` \| `null` | The page's preview image URL (from `og:image`), if any. |
| <a id="property-title"></a> `title` | `string` | The page title (from custom URL parser, Open Graph, or `<title>`). |
| <a id="property-url"></a> `url` | `string` | The URL that was unfurled. |
