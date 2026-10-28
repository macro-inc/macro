# Type Alias: PatchChannelRequest

> **PatchChannelRequest** = \{ `auto_join_team?`: `boolean` \| `null`; `channel_name?`: `string` \| `null`; `convert_to_team_channel?`: `boolean` \| `null`; \}

Request to patch a channel.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_join_team"></a> `auto_join_team?` | `boolean` \| `null` | Whether team members should automatically join the channel. |
| <a id="property-channel_name"></a> `channel_name?` | `string` \| `null` | New channel name. |
| <a id="property-convert_to_team_channel"></a> `convert_to_team_channel?` | `boolean` \| `null` | Sets whether the channel is a team channel. `true` converts a non-team channel to a team channel, while `false` converts a team channel to a private channel. |
