# Type Alias: SessionBot

> **SessionBot** = \{ `avatarUrl?`: `string` \| `null`; `handle`: `string`; `id`: [`BotId`](BotId.md); `name`: `string`; \}

The agent behind a session, as much of it as rendering a message needs.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-avatarurl"></a> `avatarUrl?` | `string` \| `null` | Avatar, when it has one. |
| <a id="property-handle"></a> `handle` | `string` | Stable `@` handle, without a leading `@`. |
| <a id="property-id"></a> `id` | [`BotId`](BotId.md) | The bot's id. A message it sent has `"bot\|{id}"` as its sender. |
| <a id="property-name"></a> `name` | `string` | Display name. |
