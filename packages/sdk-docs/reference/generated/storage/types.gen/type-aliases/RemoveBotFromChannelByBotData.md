# Type Alias: RemoveBotFromChannelByBotData

> **RemoveBotFromChannelByBotData** = \{ `body?`: `never`; `path`: \{ `bot_id`: [`BotId`](BotId.md); `channel_id`: `string`; \}; `query?`: `never`; `url`: `"/bots/{bot_id}/channels/{channel_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `bot_id`: [`BotId`](BotId.md); `channel_id`: `string`; \} | - |
| `path.bot_id` | [`BotId`](BotId.md) | Bot ID |
| `path.channel_id` | `string` | Channel ID |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/bots/{bot_id}/channels/{channel_id}"` | - |
