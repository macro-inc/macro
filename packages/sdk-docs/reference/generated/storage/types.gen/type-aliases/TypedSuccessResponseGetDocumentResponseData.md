# Type Alias: TypedSuccessResponseGetDocumentResponseData

> **TypedSuccessResponseGetDocumentResponseData** = \{ `data`: \{ `documentMetadata`: [`DocumentMetadataWithContent`](DocumentMetadataWithContent.md); `userAccessLevel`: [`AccessLevel`](AccessLevel.md); `viewLocation?`: `string` \| `null`; \}; `error`: `boolean`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-data"></a> `data` | \{ `documentMetadata`: [`DocumentMetadataWithContent`](DocumentMetadataWithContent.md); `userAccessLevel`: [`AccessLevel`](AccessLevel.md); `viewLocation?`: `string` \| `null`; \} | Get document response data with content lifecycle metadata. |
| `data.documentMetadata` | [`DocumentMetadataWithContent`](DocumentMetadataWithContent.md) | The metadata of the document. |
| `data.userAccessLevel` | [`AccessLevel`](AccessLevel.md) | The user's level of access to the document. |
| `data.viewLocation?` | `string` \| `null` | The user's view location if there is one. |
| <a id="property-error"></a> `error` | `boolean` | Indicates if an error occurred |
