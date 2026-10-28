# Type Alias: ChannelWithParticipants

> **ChannelWithParticipants** = \{ `channel`: [`Channel`](Channel.md); `is_participant?`: `boolean`; `participants`: [`ChannelParticipant`](ChannelParticipant.md)[]; \}

Channel metadata together with its participants.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel"></a> `channel` | [`Channel`](Channel.md) | Channel metadata. |
| <a id="property-is_participant"></a> `is_participant?` | `boolean` | Whether the requesting user is an active participant of the channel. False for team channels of the user's teams they have not joined. |
| <a id="property-participants"></a> `participants` | [`ChannelParticipant`](ChannelParticipant.md)[] | Participants in the channel. |
