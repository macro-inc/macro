# Type Alias: ChannelMentionMetadata

> **ChannelMentionMetadata** = [`CommonChannelMetadata`](CommonChannelMetadata.md) & \{ `messageContent`: `string`; `messageId`: `string`; `senderDisplayName?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; `threadId?`: `string` \| `null`; \}

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `messageContent` | `string` | The message content |
| `messageId` | `string` | The message you were mentioned in |
| `senderDisplayName?` | `string` \| `null` | Display name for non-user senders such as bots |
| `senderProfilePictureUrl?` | `string` \| `null` | - |
| `threadId?` | `string` \| `null` | the id of the thread |
