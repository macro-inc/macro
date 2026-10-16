# Type Alias: UserDocumentsResponse

> **UserDocumentsResponse** = \{ `documents`: [`DocumentMetadata`](DocumentMetadata.md)[]; `next_offset?`: `number` \| `null`; `total`: `number`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documents"></a> `documents` | [`DocumentMetadata`](DocumentMetadata.md)[] | - |
| <a id="property-next_offset"></a> `next_offset?` | `number` \| `null` | The next offset to be used if there is one |
| <a id="property-total"></a> `total` | `number` | The total number of documents the user has |
