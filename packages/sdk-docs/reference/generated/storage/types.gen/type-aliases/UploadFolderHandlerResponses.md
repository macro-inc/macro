# Type Alias: UploadFolderHandlerResponses

> **UploadFolderHandlerResponses** = \{ `200`: \{ `data`: \{ `destinationMap`: [`HashMap`](HashMap.md); `fileSystem`: [`FileSystemNodeWithIds`](FileSystemNodeWithIds.md); \}; `error`: `boolean`; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `data`: \{ `destinationMap`: [`HashMap`](HashMap.md); `fileSystem`: [`FileSystemNodeWithIds`](FileSystemNodeWithIds.md); \}; `error`: `boolean`; \} | - |
| `200.data` | \{ `destinationMap`: [`HashMap`](HashMap.md); `fileSystem`: [`FileSystemNodeWithIds`](FileSystemNodeWithIds.md); \} | Data to be returned |
| `200.data.destinationMap` | [`HashMap`](HashMap.md) | maps document id to presigned url (external) or s3 info (internal) |
| `200.data.fileSystem` | [`FileSystemNodeWithIds`](FileSystemNodeWithIds.md) | file system with project ids and document ids |
| `200.error` | `boolean` | Indicates if an error occurred |
