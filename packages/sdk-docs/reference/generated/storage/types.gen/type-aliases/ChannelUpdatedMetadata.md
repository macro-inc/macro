# Type Alias: ChannelUpdatedMetadata

> **ChannelUpdatedMetadata** = \{ `actor`: [`MacroUserIdStr`](MacroUserIdStr.md); `channel_id`: `string`; `channel_name?`: `string` \| `null`; `previous_name?`: `string` \| `null`; \}

Metadata for [`ChannelTopicEvent::Updated`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actor"></a> `actor` | [`MacroUserIdStr`](MacroUserIdStr.md) | The user who updated the channel. |
| <a id="property-channel_id"></a> `channel_id` | `string` | The id of the updated channel. |
| <a id="property-channel_name"></a> `channel_name?` | `string` \| `null` | New channel name. |
| <a id="property-previous_name"></a> `previous_name?` | `string` \| `null` | Stored channel name before the update. |
