# Type Alias: GetBotOwnerProfilesData

> **GetBotOwnerProfilesData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `ids?`: [`BotId`](BotId.md)[]; \}; `url`: `"/bots/profiles"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `ids?`: [`BotId`](BotId.md)[]; \} | - |
| `query.ids?` | [`BotId`](BotId.md)[] | Bot ids. Repeat the key: `?ids=<uuid>&ids=<uuid>`. |
| <a id="property-url"></a> `url` | `"/bots/profiles"` | - |
