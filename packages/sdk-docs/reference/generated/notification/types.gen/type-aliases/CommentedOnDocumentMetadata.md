# Type Alias: CommentedOnDocumentMetadata

> **CommentedOnDocumentMetadata** = \{ `commentId`: [`CommentRef`](CommentRef.md); `documentName`: `string`; `fileType?`: `string` \| `null`; `owner`: `string`; `senderDisplayName?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; `subType?`: `null` \| [`NotificationDocumentSubType`](NotificationDocumentSubType.md); `text`: `string`; `threadId`: [`CommentRef`](CommentRef.md); \}

Notification sent when someone comments on a document the user owns.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-commentid"></a> `commentId` | [`CommentRef`](CommentRef.md) | the comment id |
| <a id="property-documentname"></a> `documentName` | `string` | The name of the document. |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | The file type of the document. |
| <a id="property-owner"></a> `owner` | `string` | The owner of the document. |
| <a id="property-senderdisplayname"></a> `senderDisplayName?` | `string` \| `null` | Public bot name when the author is an agent rather than a Macro user. |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | - |
| <a id="property-subtype"></a> `subType?` | `null` \| [`NotificationDocumentSubType`](NotificationDocumentSubType.md) | - |
| <a id="property-text"></a> `text` | `string` | the text of the comment |
| <a id="property-threadid"></a> `threadId` | [`CommentRef`](CommentRef.md) | the thread id |
