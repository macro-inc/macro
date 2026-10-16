# Type Alias: ChannelMessageReactionMetadata

> **ChannelMessageReactionMetadata** = [`CommonChannelMetadata`](CommonChannelMetadata.md) & \{ `emoji`: `string`; `messageContent`: `string`; `messageId`: `string`; `senderProfilePictureUrl?`: `string` \| `null`; `threadId?`: `string` \| `null`; \}

Metadata for a reaction added to one of the recipient's channel messages.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `emoji` | `string` | The emoji added by the reactor. |
| `messageContent` | `string` | The reacted-to message content. |
| `messageId` | `string` | The reacted-to message id. |
| `senderProfilePictureUrl?` | `string` \| `null` | Optional reactor profile picture URL. |
| `threadId?` | `string` \| `null` | The thread root id when the reacted-to message is a reply. |
