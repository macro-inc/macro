# Type Alias: LocationResponseData

> **LocationResponseData** = \{ `presignedUrl`: `string`; \} \| \{ `presignedUrls`: [`PresignedUrl`](PresignedUrl.md)[]; \}

## Union Members

### Type Literal

\{ `presignedUrl`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `presignedUrl` | `string` | The presigned url of the document if it is not a docx |

***

### Type Literal

\{ `presignedUrls`: [`PresignedUrl`](PresignedUrl.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `presignedUrls` | [`PresignedUrl`](PresignedUrl.md)[] | The presigned urls of the docx bom parts if it is a docx |
