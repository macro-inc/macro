# Type Alias: LocationResponseV3

> **LocationResponseV3** = \{ `content`: [`DocumentContent`](DocumentContent.md); `metadata`: [`DocumentBasic`](DocumentBasic.md); `presignedUrl`: `string`; `type`: `"presignedUrl"`; \} \| \{ `content`: [`DocumentContent`](DocumentContent.md); `metadata`: [`DocumentBasic`](DocumentBasic.md); `presignedUrls`: [`PresignedUrl`](PresignedUrl.md)[]; `type`: `"presignedUrls"`; \} \| \{ `content`: [`DocumentContent`](DocumentContent.md); `metadata`: [`DocumentBasic`](DocumentBasic.md); `type`: `"syncServiceContent"`; \}

Location response with content lifecycle metadata.

## Union Members

### Type Literal

\{ `content`: [`DocumentContent`](DocumentContent.md); `metadata`: [`DocumentBasic`](DocumentBasic.md); `presignedUrl`: `string`; `type`: `"presignedUrl"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`DocumentContent`](DocumentContent.md) | Content lifecycle and location metadata. |
| `metadata` | [`DocumentBasic`](DocumentBasic.md) | Basic document metadata. |
| `presignedUrl` | `string` | Presigned URL. |
| `type` | `"presignedUrl"` | - |

***

### Type Literal

\{ `content`: [`DocumentContent`](DocumentContent.md); `metadata`: [`DocumentBasic`](DocumentBasic.md); `presignedUrls`: [`PresignedUrl`](PresignedUrl.md)[]; `type`: `"presignedUrls"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`DocumentContent`](DocumentContent.md) | Content lifecycle and location metadata. |
| `metadata` | [`DocumentBasic`](DocumentBasic.md) | Basic document metadata. |
| `presignedUrls` | [`PresignedUrl`](PresignedUrl.md)[] | Presigned URLs. |
| `type` | `"presignedUrls"` | - |

***

### Type Literal

\{ `content`: [`DocumentContent`](DocumentContent.md); `metadata`: [`DocumentBasic`](DocumentBasic.md); `type`: `"syncServiceContent"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`DocumentContent`](DocumentContent.md) | Content lifecycle and location metadata. |
| `metadata` | [`DocumentBasic`](DocumentBasic.md) | Basic document metadata. |
| `type` | `"syncServiceContent"` | - |
