# Type Alias: ChannelDeletedMetadata

> **ChannelDeletedMetadata** = \{ `actor`: [`ChannelSender`](ChannelSender.md); `channel_id`: `string`; \}

Metadata for [`ChannelTopicEvent::Deleted`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor` | [`ChannelSender`](ChannelSender.md) | Actor that deleted the channel. |
| <a id="property-channel_id"></a> `channel_id` | `string` | The id of the deleted channel. |
