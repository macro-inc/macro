# Type Alias: ApiChannelDetail

> **ApiChannelDetail** = \{ `channel_id`: `string`; `channel_name`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); `participants`: [`ApiChannelParticipant`](ApiChannelParticipant.md)[]; \}

Channel detail: metadata and active participants.

Messages are read through `/messages/channel/{channel_id}`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel id. |
| <a id="property-channel_name"></a> `channel_name` | `string` | Resolved display name from the viewer's perspective. |
| <a id="property-channel_type"></a> `channel_type` | [`ChannelType`](ChannelType.md) | Channel type. |
| <a id="property-participants"></a> `participants` | [`ApiChannelParticipant`](ApiChannelParticipant.md)[] | Active participants. |
