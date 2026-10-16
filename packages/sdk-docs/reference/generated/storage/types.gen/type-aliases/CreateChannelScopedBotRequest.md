# Type Alias: CreateChannelScopedBotRequest

> **CreateChannelScopedBotRequest** = \{ `avatar_url?`: `string` \| `null`; `description?`: `string` \| `null`; `handle`: `string`; `has_agent?`: `boolean` \| `null`; `name`: `string`; `team_id?`: `string` \| `null`; `token_expires_at?`: `string` \| `null`; `token_label?`: `string` \| `null`; \}

Request to create a bot scoped to a channel.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-avatar_url"></a> `avatar_url?` | `string` \| `null` | Optional avatar URL. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional description. |
| <a id="property-handle"></a> `handle` | `string` | Stable handle. |
| <a id="property-has_agent"></a> `has_agent?` | `boolean` \| `null` | Whether mentioning this bot opens a sandboxed coding-agent session. Defaults to false. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Team owner. The caller must be a team administrator or owner. Omit for a user-owned bot. |
| <a id="property-token_expires_at"></a> `token_expires_at?` | `string` \| `null` | Optional token expiration timestamp. |
| <a id="property-token_label"></a> `token_label?` | `string` \| `null` | Optional token label. |
