# Type Alias: ChannelReplyMetadata

> **ChannelReplyMetadata** = [`CommonChannelMetadata`](CommonChannelMetadata.md) & \{ `messageContent`: `string`; `messageId`: `string`; `senderDisplayName?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; `threadId`: `string`; `threadParentSenderId?`: `string` \| `null`; `userId?`: `string` \| `null`; \}

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `messageContent` | `string` | The message content |
| `messageId` | `string` | The id of the new message |
| `senderDisplayName?` | `string` \| `null` | Display name for non-user senders such as bots |
| `senderProfilePictureUrl?` | `string` \| `null` | - |
| `threadId` | `string` | The id of the thread that has the reply |
| `threadParentSenderId?` | `string` \| `null` | The user who sent the root message of the thread |
| `userId?` | `string` \| `null` | The sender id of the reply, when sent by a user |
