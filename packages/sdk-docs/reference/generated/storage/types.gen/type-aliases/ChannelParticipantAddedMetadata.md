# Type Alias: ChannelParticipantAddedMetadata

> **ChannelParticipantAddedMetadata** = \{ `added_by`: [`ChannelSender`](ChannelSender.md); `added_user_ids`: [`MacroUserIdStr`](MacroUserIdStr.md)[]; `channel_id`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); \}

Metadata for [`ChannelTopicEvent::ParticipantAdded`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-added_by"></a> `added_by` | [`ChannelSender`](ChannelSender.md) | Actor who added the participants; equals the sole added user for a self-service join. |
| <a id="property-added_user_ids"></a> `added_user_ids` | [`MacroUserIdStr`](MacroUserIdStr.md)[] | Users added by this mutation. |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel receiving new participants. |
| <a id="property-channel_type"></a> `channel_type` | [`ChannelType`](ChannelType.md) | Type of channel that received participants. |
