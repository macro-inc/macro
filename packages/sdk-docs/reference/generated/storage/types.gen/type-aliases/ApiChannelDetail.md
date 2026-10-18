# Type Alias: ApiChannelDetail

> **ApiChannelDetail** = \{ `auto_join_team`: `boolean`; `channel_id`: `string`; `channel_name`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); `messaging_binding`: [`MessagingBinding`](MessagingBinding.md); `participants`: [`ApiChannelParticipant`](ApiChannelParticipant.md)[]; \}

Channel detail: metadata and active participants.

Messages are read through `/messages/channel/{channel_id}`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_join_team"></a> `auto_join_team` | `boolean` | Whether new team members automatically join this channel. |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel id. |
| <a id="property-channel_name"></a> `channel_name` | `string` | Resolved display name from the viewer's perspective. |
| <a id="property-channel_type"></a> `channel_type` | [`ChannelType`](ChannelType.md) | Channel type. |
| <a id="property-messaging_binding"></a> `messaging_binding` | [`MessagingBinding`](MessagingBinding.md) | Authoritative external binding. |
| <a id="property-participants"></a> `participants` | [`ApiChannelParticipant`](ApiChannelParticipant.md)[] | Active participants. |
