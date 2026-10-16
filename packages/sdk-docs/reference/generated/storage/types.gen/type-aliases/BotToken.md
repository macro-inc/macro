# Type Alias: BotToken

> **BotToken** = \{ `bot_id`: [`BotId`](BotId.md); `created_at`: `string`; `expires_at?`: `string` \| `null`; `id`: `string`; `label?`: `string` \| `null`; `last_used_at?`: `string` \| `null`; `revoked_at?`: `string` \| `null`; `token_prefix`: `string`; \}

Bot token metadata.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot_id"></a> `bot_id` | [`BotId`](BotId.md) | Owning bot id. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-expires_at"></a> `expires_at?` | `string` \| `null` | Expiration timestamp. |
| <a id="property-id"></a> `id` | `string` | Token id. |
| <a id="property-label"></a> `label?` | `string` \| `null` | Optional token label. |
| <a id="property-last_used_at"></a> `last_used_at?` | `string` \| `null` | Last successful use. |
| <a id="property-revoked_at"></a> `revoked_at?` | `string` \| `null` | Revocation timestamp. |
| <a id="property-token_prefix"></a> `token_prefix` | `string` | Display prefix of the bearer token. The raw secret is never stored here. |
