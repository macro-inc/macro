# Type Alias: ChannelAccessRequestedMetadata

> **ChannelAccessRequestedMetadata** = [`CommonChannelMetadata`](CommonChannelMetadata.md) & \{ `requestId`: `string`; `senderProfilePictureUrl?`: `string` \| `null`; \}

A person asked to join a channel the recipient participates in.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `requestId` | `string` | The attempt to join, which is also this notification's id. |
| `senderProfilePictureUrl?` | `string` \| `null` | Optional requester profile picture URL. |
