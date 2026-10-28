# Type Alias: ChannelParticipant

> **ChannelParticipant** = \{ `channel_id`: `string`; `joined_at`: `string`; `left_at?`: `string` \| `null`; `role`: [`ParticipantRole`](ParticipantRole.md); `user_id`: `string`; \}

A user's membership in a channel.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel id for the participant membership. |
| <a id="property-joined_at"></a> `joined_at` | `string` | Timestamp when the participant joined the channel. |
| <a id="property-left_at"></a> `left_at?` | `string` \| `null` | Timestamp when the participant left the channel, if any. |
| <a id="property-role"></a> `role` | [`ParticipantRole`](ParticipantRole.md) | Participant role in the channel. |
| <a id="property-user_id"></a> `user_id` | `string` | Participant user id. |
