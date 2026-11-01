# Type Alias: SaveDocumentResponseData

> **SaveDocumentResponseData** = \{ `documentMetadata`: [`DocumentResponseMetadata`](DocumentResponseMetadata.md); `presignedUrl?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documentmetadata"></a> `documentMetadata` | [`DocumentResponseMetadata`](DocumentResponseMetadata.md) | The updated document metadata |
| <a id="property-presignedurl"></a> `presignedUrl?` | `string` \| `null` | If the document is an editable file, we provide a presigned url to save the updated file to. |
