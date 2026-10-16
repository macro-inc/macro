# Type Alias: PostChannelBotWebhookData

> **PostChannelBotWebhookData** = \{ `body`: [`ChannelWebhookRequest`](ChannelWebhookRequest.md); `headers?`: \{ `x-macro-bot-token?`: `string` \| `null`; `x-macro-channel-bot-token?`: `string` \| `null`; \}; `path`: \{ `channel_id`: `string`; \}; `query?`: `never`; `url`: `"/channels/{channel_id}/webhook"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`ChannelWebhookRequest`](ChannelWebhookRequest.md) | - |
| <a id="property-headers"></a> `headers?` | \{ `x-macro-bot-token?`: `string` \| `null`; `x-macro-channel-bot-token?`: `string` \| `null`; \} | - |
| `headers.x-macro-bot-token?` | `string` \| `null` | Preferred bot authentication token |
| ~~`headers.x-macro-channel-bot-token?`~~ | `string` \| `null` | Legacy channel-scoped bot authentication token **Deprecated** |
| <a id="property-path"></a> `path` | \{ `channel_id`: `string`; \} | - |
| `path.channel_id` | `string` | Channel ID |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/channels/{channel_id}/webhook"` | - |
