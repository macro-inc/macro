# Type Alias: ChannelParticipantRemovedMetadata

> **ChannelParticipantRemovedMetadata** = \{ `channel_id`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); `removed_by`: [`MacroUserIdStr`](MacroUserIdStr.md); `removed_user_ids`: [`MacroUserIdStr`](MacroUserIdStr.md)[]; \}

Metadata for [`ChannelTopicEvent::ParticipantRemoved`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel the participants were removed from. |
| <a id="property-channel_type"></a> `channel_type` | [`ChannelType`](ChannelType.md) | Type of channel the participants were removed from. |
| <a id="property-removed_by"></a> `removed_by` | [`MacroUserIdStr`](MacroUserIdStr.md) | Actor who removed the participants; equals the sole removed user for a self-service leave. |
| <a id="property-removed_user_ids"></a> `removed_user_ids` | [`MacroUserIdStr`](MacroUserIdStr.md)[] | Users removed by this mutation. |
