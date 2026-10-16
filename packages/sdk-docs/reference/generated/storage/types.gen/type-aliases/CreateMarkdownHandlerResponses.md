# Type Alias: CreateMarkdownHandlerResponses

> **CreateMarkdownHandlerResponses** = \{ `200`: \{ `documentId`: `string`; `documentMetadata`: [`DocumentResponseMetadata`](DocumentResponseMetadata.md); `token`: `string`; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `documentId`: `string`; `documentMetadata`: [`DocumentResponseMetadata`](DocumentResponseMetadata.md); `token`: `string`; \} | Response for creating a markdown document. |
| `200.documentId` | `string` | The document ID of the created markdown document |
| `200.documentMetadata` | [`DocumentResponseMetadata`](DocumentResponseMetadata.md) | Metadata for the created document |
| `200.token` | `string` | A pre-generated permission token that you can use for SS |
