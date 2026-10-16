# Type Alias: CreateChannelRequest

> **CreateChannelRequest** = \{ `auto_join_team?`: `boolean`; `channel_type`: [`ChannelType`](ChannelType.md); `name?`: `string` \| `null`; `participants`: `string`[]; `team_id?`: `string` \| `null`; \}

Request to create a channel.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_join_team"></a> `auto_join_team?` | `boolean` | Whether team members automatically join this channel. Defaults to false. |
| <a id="property-channel_type"></a> `channel_type` | [`ChannelType`](ChannelType.md) | Channel type. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Optional channel name. |
| <a id="property-participants"></a> `participants` | `string`[] | Participants to add, excluding the owner. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Team id for team channels. |
