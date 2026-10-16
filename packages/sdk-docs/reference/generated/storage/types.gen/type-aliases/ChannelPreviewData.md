# Type Alias: ChannelPreviewData

> **ChannelPreviewData** = \{ `channel_id`: `string`; `channel_name`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); `profile_picture_id?`: `string` \| `null`; \}

Preview payload returned for accessible channels.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel id. |
| <a id="property-channel_name"></a> `channel_name` | `string` | Resolved channel display name. |
| <a id="property-channel_type"></a> `channel_type` | [`ChannelType`](ChannelType.md) | Channel type. |
| <a id="property-profile_picture_id"></a> `profile_picture_id?` | `string` \| `null` | Static image file used as the channel's profile picture, when accessible. |
