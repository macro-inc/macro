# Type Alias: SessionIdentity

> **SessionIdentity** = \{ `audience?`: [`MacroUserIdStr`](MacroUserIdStr.md)[]; `bot_id`: [`BotId`](BotId.md); `bot_name`: `string`; `origin?`: `null` \| [`ThreadOrigin`](ThreadOrigin.md); `owner_id`: [`MacroUserIdStr`](MacroUserIdStr.md); `session_id`: `string`; `session_name`: `string`; `source?`: [`SessionSource`](SessionSource.md); \}

Who and what a session is; carried by every lifecycle event so a
consumer never has to look the session up.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-audience"></a> `audience?` | [`MacroUserIdStr`](MacroUserIdStr.md)[] | Everyone with a stake in what happens next: the owner plus every user who has prompted or answered this session. Resolved by the emitter so a consumer fanning out never has to read the session's log. |
| <a id="property-bot_id"></a> `bot_id` | [`BotId`](BotId.md) | Bot the session runs for. |
| <a id="property-bot_name"></a> `bot_name` | `string` | The bot's display name at the time of the event. |
| <a id="property-origin"></a> `origin?` | `null` \| [`ThreadOrigin`](ThreadOrigin.md) | - |
| <a id="property-owner_id"></a> `owner_id` | [`MacroUserIdStr`](MacroUserIdStr.md) | User who owns the session. |
| <a id="property-session_id"></a> `session_id` | `string` | The session. |
| <a id="property-session_name"></a> `session_name` | `string` | User-facing session name at the time of the event. |
| <a id="property-source"></a> `source?` | [`SessionSource`](SessionSource.md) | Who started the session. Events from before it was recorded say nothing and read as a person. |
