# Type Alias: SaveDocumentRequest

> **SaveDocumentRequest** = \{ `modificationData?`: `unknown`; `newBom?`: [`SaveBomPart`](SaveBomPart.md)[] \| `null`; `sha?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-modificationdata"></a> `modificationData?` | `unknown` | The modification data for the document instance. Used to store highlights and other overlays onto a static file |
| <a id="property-newbom"></a> `newBom?` | [`SaveBomPart`](SaveBomPart.md)[] \| `null` | **DOCX ONLY** The updated BOM for the document. Containing the file path and the sha. |
| <a id="property-sha"></a> `sha?` | `string` \| `null` | The sha of the new document. This is used to generate a presigned url to upload the new document content to s3. |
