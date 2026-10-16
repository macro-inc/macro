# Type Alias: UploadExtractFolderHandlerResponses

> **UploadExtractFolderHandlerResponses** = \{ `200`: \{ `data`: \{ `presignedUrl`: `string`; `requestId`: `string`; \}; `error`: `boolean`; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `data`: \{ `presignedUrl`: `string`; `requestId`: `string`; \}; `error`: `boolean`; \} | - |
| `200.data` | \{ `presignedUrl`: `string`; `requestId`: `string`; \} | Data to be returned |
| `200.data.presignedUrl` | `string` | - |
| `200.data.requestId` | `string` | - |
| `200.error` | `boolean` | Indicates if an error occurred |
