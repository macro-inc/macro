# Type Alias: AgentConversationDto

> **AgentConversationDto** = \{ `available`: `boolean`; `avatarUrl?`: `string` \| `null`; `botId`: `string`; `channelId`: `string`; `name`: `string`; `sessions`: [`AgentConversationSessionDto`](AgentConversationSessionDto.md)[]; `settingsChanged`: `boolean`; `turns`: [`AgentConversationTurnDto`](AgentConversationTurnDto.md)[]; \}

An agent's conversation in a channel, as the person it is with sees it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-available"></a> `available` | `boolean` | Whether the caller may currently send a new prompt. |
| <a id="property-avatarurl"></a> `avatarUrl?` | `string` \| `null` | Optional persona avatar. |
| <a id="property-botid"></a> `botId` | `string` | Persona id (without the bot principal prefix). |
| <a id="property-channelid"></a> `channelId` | `string` | The channel containing the visible transcript. |
| <a id="property-name"></a> `name` | `string` | Persona's historical display name. |
| <a id="property-sessions"></a> `sessions` | [`AgentConversationSessionDto`](AgentConversationSessionDto.md)[] | The sessions the conversation has run on, oldest first. |
| <a id="property-settingschanged"></a> `settingsChanged` | `boolean` | Whether new persona settings are available to adopt explicitly. |
| <a id="property-turns"></a> `turns` | [`AgentConversationTurnDto`](AgentConversationTurnDto.md)[] | Persistent state of each accepted message and its current attempt. |
