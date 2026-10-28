# Type Alias: ChannelMessageSendMetadata

> **ChannelMessageSendMetadata** = [`CommonChannelMetadata`](CommonChannelMetadata.md) & \{ `messageContent?`: `string`; `messageId`: `string`; `sender?`: `string` \| `null`; `senderDisplayName?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; \}

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `messageContent?` | `string` | The content of the message |
| `messageId` | `string` | The message id |
| `sender?` | `string` \| `null` | The user who sent the message, when sent by a user |
| `senderDisplayName?` | `string` \| `null` | Display name for non-user senders such as bots |
| `senderProfilePictureUrl?` | `string` \| `null` | - |
