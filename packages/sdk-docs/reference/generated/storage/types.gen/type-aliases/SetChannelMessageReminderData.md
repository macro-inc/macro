# Type Alias: SetChannelMessageReminderData

> **SetChannelMessageReminderData** = \{ `body`: [`SetChannelMessageReminder`](SetChannelMessageReminder.md); `path`: \{ `channel_id`: `string`; `message_id`: `string`; \}; `query?`: `never`; `url`: `"/reminders/channels/{channel_id}/messages/{message_id}"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`SetChannelMessageReminder`](SetChannelMessageReminder.md) |
| <a id="property-path"></a> `path` | \{ `channel_id`: `string`; `message_id`: `string`; \} |
| `path.channel_id` | `string` |
| `path.message_id` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/reminders/channels/{channel_id}/messages/{message_id}"` |
