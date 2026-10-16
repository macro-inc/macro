# Type Alias: PatchBotRequest

> **PatchBotRequest** = \{ `avatar_url?`: `string` \| `null`; `description?`: `string` \| `null`; `handle?`: `string` \| `null`; `has_agent?`: `boolean` \| `null`; `name?`: `string` \| `null`; \}

Request to patch a bot.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-avatar_url"></a> `avatar_url?` | `string` \| `null` | Optional avatar URL. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional description. |
| <a id="property-handle"></a> `handle?` | `string` \| `null` | Stable handle. |
| <a id="property-has_agent"></a> `has_agent?` | `boolean` \| `null` | Whether mentioning this bot opens a sandboxed coding-agent session. Omit to leave unchanged. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name. |
