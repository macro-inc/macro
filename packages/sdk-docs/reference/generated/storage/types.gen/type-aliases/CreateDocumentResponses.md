# Type Alias: CreateDocumentResponses

> **CreateDocumentResponses** = \{ `200`: \{ `data`: [`DocumentResponse`](DocumentResponse.md) & \{ `contentType`: `string`; `fileType?`: `string` \| `null`; \}; `error`: `boolean`; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `data`: [`DocumentResponse`](DocumentResponse.md) & \{ `contentType`: `string`; `fileType?`: `string` \| `null`; \}; `error`: `boolean`; \} | - |
| `200.data` | [`DocumentResponse`](DocumentResponse.md) & \{ `contentType`: `string`; `fileType?`: `string` \| `null`; \} | Create document response data with content lifecycle metadata. |
| `200.error` | `boolean` | Indicates if an error occurred |
