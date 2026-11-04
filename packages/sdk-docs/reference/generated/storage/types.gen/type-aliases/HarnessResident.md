# Type Alias: HarnessResident

> **HarnessResident** = \{ `bot_id`: [`BotId`](BotId.md); `name`: `string`; `owner_user_id?`: `string` \| `null`; `team_id?`: `string` \| `null`; \}

An agent that lives on a runtime, as opposed to a coding agent directed
there turn by turn. Anyone who can reach it can talk to it; it stays up only
while its own owner can use the runtime.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot_id"></a> `bot_id` | [`BotId`](BotId.md) | Bot id. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-owner_user_id"></a> `owner_user_id?` | `string` \| `null` | The user owning the agent, when a person does. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | The team owning the agent, when a team does. |
