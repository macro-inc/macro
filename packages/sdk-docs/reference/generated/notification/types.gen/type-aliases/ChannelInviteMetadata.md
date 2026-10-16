# Type Alias: ChannelInviteMetadata

> **ChannelInviteMetadata** = \{ `channelName?`: `string`; `invitedBy`: `string`; `isDirectMessage?`: `boolean`; `messageContent?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; \}

Metadata for when a user is invited to a channel.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelname"></a> `channelName?` | `string` | The name of the channel |
| <a id="property-invitedby"></a> `invitedBy` | `string` | The user who sent the invitation |
| <a id="property-isdirectmessage"></a> `isDirectMessage?` | `boolean` | Whether this is a direct message rather than a channel invitation. Older notification payloads retain channel-invitation wording. |
| <a id="property-messagecontent"></a> `messageContent?` | `string` \| `null` | Message content to show in the invite email, when the invite was triggered by a message. |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | The sender's profile picture URL, if available. |
