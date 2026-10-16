# Type Alias: DocumentMentionMetadata

> **DocumentMentionMetadata** = [`ChannelMentionMetadata`](ChannelMentionMetadata.md) & \{ `documentName`: `string`; `fileType?`: `string` \| `null`; `owner`: `string`; `subType?`: `null` \| [`NotificationDocumentSubType`](NotificationDocumentSubType.md); \}

Someone mentioned a document in a channel

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `documentName` | `string` | The name of the document |
| `fileType?` | `string` \| `null` | The file type of the document |
| `owner` | `string` | The owner of the document |
| `subType?` | `null` \| [`NotificationDocumentSubType`](NotificationDocumentSubType.md) | - |
