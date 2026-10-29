# Type Alias: DocumentResponse

> **DocumentResponse** = \{ `documentMetadata`: [`DocumentResponseMetadataWithContent`](DocumentResponseMetadataWithContent.md); `presignedUrl?`: `string` \| `null`; \}

Document response with content lifecycle metadata.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documentmetadata"></a> `documentMetadata` | [`DocumentResponseMetadataWithContent`](DocumentResponseMetadataWithContent.md) | The document metadata. |
| <a id="property-presignedurl"></a> `presignedUrl?` | `string` \| `null` | Presigned upload URL, when the caller still needs to upload bytes. |
